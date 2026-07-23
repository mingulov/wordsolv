/**
 * Offline benchmark against the committed gold fixture. No network.
 * Run: npx tsx bin/evaluate.ts [--section lambda] [--section threshold] [--section ladder] [--section closed-loop]
 * (repeat --section to run more than one; omit it entirely to run all four)
 *
 * The fixture is 40 secrets x the game model's true top-300 neighbours, captured
 * from контекстно.рф's `/first-words` endpoint (design spec §2.1/§3). For a secret
 * S that list IS the answer key, so we can replay "player has N guesses ranked
 * <=300" entirely offline. araneum (the vector asset under test) is *our*
 * surrogate, evaluated against this fixture — it is not what the fixture's
 * neighbour lists come from.
 *
 * All four sections below share ONE `RankCache` (module-scope `cache`), because
 * `predictedRanks` depends only on a word's own index, never on which secret,
 * lambda, or threshold is under test — reusing it across the whole run avoids
 * recomputing the same ~26M-MAC matvec every time an already-seen word recurs
 * (which is common: the probe ladder is identical across every secret, and the
 * frequency prior pulls early fit guesses toward the same handful of words).
 *
 * Sections:
 *   lambda      Finding 3 — sweeps priorLambda per informative-observation count
 *               N on the TUNING split only, prints the chosen schedule, then
 *               measures it on the HELD-OUT split.
 *   threshold   Finding 4 — sweeps exploreThreshold via the closed-loop
 *               simulator on the TUNING split only, then measures the chosen
 *               value on the HELD-OUT split. Loads dict/assets/profiles.json,
 *               so run the `lambda` section first and update that file's
 *               priorLambda/priorLambdaSchedule before trusting this section's
 *               numbers.
 *   ladder      Unchanged: cold-start probe ladder (spec §6.3) vs a random
 *               common-noun baseline. No lambda, no tune/held-out split — a
 *               probe's rank for a secret is just its position in that
 *               secret's own gold list.
 *   closed-loop The headline number for BENCHMARKS.md: simulates all 40 gold
 *               secrets against the profile as shipped in profiles.json
 *               (schedule + threshold already calibrated) and reports solve
 *               rate, turns-to-solve, exploit-entry timing, and informative-
 *               observation count at solve time.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RankCache } from '../src/ranks'
import { rankCandidates, scoreCandidates, type FitObservation } from '../src/fit'
import { parseVectors } from '../src/vectors'
import { newSemanticState, normalizeWord, type ProviderProfile, type SemanticState } from '../src/types'
import { assertProbeLadderMatches, nextProbes, parseProbeLadder } from '../src/probe'
import { parseProfiles } from '../src/profile'
import { suggest } from '../src/suggest'
import { mulberry32 } from '../src/random'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const HERE = join(import.meta.dirname, '..')
const gold: Record<string, string[]> = JSON.parse(
  readFileSync(join(ROOT, 'docs/superpowers/specs/assets/contextno-gold-40x300.json'), 'utf8'),
)
const vs = parseVectors(new Uint8Array(readFileSync(join(HERE, 'dict/assets/ru.vec.bin'))))
const RANK_UNIVERSE = 21000
const TRIALS = 6

const secrets = Object.keys(gold).map(normalizeWord).filter((s) => vs.index.has(s)).sort()
const half = Math.floor(secrets.length / 2)
const tune = secrets.slice(0, half)
const heldOut = secrets.slice(half)

// Shared across every section — see the file header comment.
const cache = new RankCache(vs, RANK_UNIVERSE)

const args = process.argv.slice(2)
const requestedSections = args.flatMap((a, i) => (a === '--section' ? [args[i + 1]] : []))
const ALL_SECTIONS = ['lambda', 'threshold', 'ladder', 'closed-loop'] as const
type Section = (typeof ALL_SECTIONS)[number]
const isSection = (s: string): s is Section => (ALL_SECTIONS as readonly string[]).includes(s)
const sections = new Set<Section>(
  requestedSections.length > 0 ? requestedSections.filter(isSection) : ALL_SECTIONS,
)

console.log(`secrets: ${secrets.length} (tune ${tune.length}, held-out ${heldOut.length})`)
console.log(`tune split:     ${tune.join(', ')}`)
console.log(`held-out split: ${heldOut.join(', ')}`)
console.log(`sections: ${[...sections].join(', ')}`)

function positions(group: string[], n: number, lambda: number): number[] {
  const rng = mulberry32(11)
  const out: number[] = []
  for (const secret of group) {
    const neighbours = gold[secret].map(normalizeWord).slice(1).filter((w) => vs.index.has(w))
    if (neighbours.length < n) continue
    for (let t = 0; t < TRIALS; t++) {
      const picked = new Set<number>()
      while (picked.size < n) picked.add(Math.floor(rng() * neighbours.length))
      const obs: FitObservation[] = [...picked].map((i) => ({
        index: vs.index.get(neighbours[i])!,
        rank: gold[secret].map(normalizeWord).indexOf(neighbours[i]) + 1,
      }))
      const scores = scoreCandidates(vs, cache, obs, lambda)
      const order = rankCandidates(scores, new Set(), vs.words.length)
      out.push(order.indexOf(vs.index.get(secret)!) + 1)
    }
  }
  return out
}

function summarise(p: number[]): string {
  const sorted = [...p].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const top10 = (p.filter((x) => x <= 10).length / p.length) * 100
  const top50 = (p.filter((x) => x <= 50).length / p.length) * 100
  return `median ${median}, top-10 ${top10.toFixed(0)}%, top-50 ${top50.toFixed(0)}%`
}

// ---------------------------------------------------------------------------
// Finding 3: priorLambda schedule, calibrated per informative-observation count.
// ---------------------------------------------------------------------------
if (sections.has('lambda')) {
  console.log('\n=== Finding 3: lambda schedule sweep (tuning split only) ===')
  const N_VALUES = [1, 2, 3, 4, 5, 8]
  const LAMBDA_GRID = [0, 0.02, 0.05, 0.1, 0.25, 0.5, 1]

  const schedule: { n: number; lambda: number }[] = []
  for (const n of N_VALUES) {
    let best = { lambda: LAMBDA_GRID[0], median: Infinity }
    for (const lambda of LAMBDA_GRID) {
      const p = positions(tune, n, lambda)
      const median = [...p].sort((a, b) => a - b)[Math.floor(p.length / 2)]
      console.log(`  tune N=${n} lambda=${lambda}: ${summarise(p)}`)
      if (median < best.median) best = { lambda, median }
    }
    schedule.push({ n, lambda: best.lambda })
  }

  console.log('\nchosen schedule (tuning split, lowest median wins):')
  for (const { n, lambda } of schedule) console.log(`  N<=${n} -> lambda=${lambda}`)

  console.log('\nheld-out performance of the chosen per-N schedule:')
  for (const { n, lambda } of schedule) {
    console.log(`  HELD-OUT N=${n} (lambda=${lambda}): ${summarise(positions(heldOut, n, lambda))}`)
  }
}

// ---------------------------------------------------------------------------
// Closed-loop simulator, shared by the `threshold` and `closed-loop` sections.
//
// Two player policies, used for two different purposes — a single policy
// cannot serve both, and using the wrong one silently makes a sweep vacuous
// (verified: running the `prefer-fit` policy through the exploreThreshold
// sweep below produced byte-identical results at every threshold, because
// that policy never even looks at `regime`):
//
//   'top1'       Always play `suggestions[0]` — the solver's literal top pick.
//                Probes lead in explore mode (Finding 2 caps them at roughly
//                half of `limit`, never zero, but never removes them from the
//                front either), so this policy walks the ladder in order for
//                as long as `regime` stays 'explore', and switches to
//                following the fit once `regime` flips to 'exploit'. This is
//                what makes exploreThreshold causally matter — it is the only
//                thing that moves the explore->exploit transition point — so
//                it is the right policy for the Finding 4 sweep. Findings 2/3
//                have no effect under this policy (probes are unaffected by
//                either fix, and the transition point depends only on probe
//                ranks vs. the threshold), which is fine: threshold
//                calibration should isolate the threshold's own effect.
//
//   'prefer-fit' Once at least one informative (vectorised, rank-bearing)
//                observation exists AND the fit has a candidate to offer,
//                follow the fit's own best-ranked candidate instead of the
//                next scripted probe — modelling a player who takes advantage
//                of the low-confidence fit candidates Finding 2 now surfaces
//                alongside probes, rather than mechanically working through
//                the whole ladder first. This is the policy that shows
//                Findings 2 and 3 in the headline closed-loop number: pre-fix,
//                `remaining` stayed 0 (no fit candidate to prefer) until ~30 of
//                40 probes were already used, so this policy degenerated to
//                "always play the next probe" for a long stretch, matching
//                the reviewer-reported "~25 probes before the model is
//                consulted even once".
//
// True ranks come only from the gold fixture's own top-300 list per secret
// (index 0 is the secret itself, rank 1). A guess outside that list has no
// discoverable rank in this fixture (only контекстно.рф's `/first-words`
// captured the top-300, spec §2.1) — modelled as "played, no usable signal" by
// recording it in `rejected` (an evaluation-harness simplification: it is not a
// real provider rejection, just the cheapest way to stop it being re-suggested
// without inventing a rank we cannot know).
// ---------------------------------------------------------------------------
type ClosedLoopPolicy = 'top1' | 'prefer-fit'

interface ClosedLoopResult {
  secret: string
  solved: boolean
  turns: number | null
  enteredExploitAtTurn: number | null
  everGotTop300: boolean
  informativeAtSolve: number | null
}

function simulatePuzzle(
  secret: string,
  profile: ProviderProfile,
  ladder: string[],
  maxTurns: number,
  policy: ClosedLoopPolicy,
): ClosedLoopResult {
  let state: SemanticState = newSemanticState(profile.id)
  let enteredExploitAtTurn: number | null = null
  let everGotTop300 = false
  const goldList = gold[secret].map(normalizeWord)
  const rankOf = new Map<string, number>()
  goldList.forEach((w, i) => rankOf.set(w, i + 1))

  for (let turn = 1; turn <= maxTurns; turn++) {
    const result = suggest({ state, vectors: vs, profile, ladder, cache, limit: 10 })
    if (result.suggestions.length === 0) break // already solved (defensive; loop should have returned first)
    if (enteredExploitAtTurn === null && result.regime === 'exploit') enteredExploitAtTurn = turn

    const informativeCount = state.observations.length
    const fitPick =
      policy === 'prefer-fit' && informativeCount > 0
        ? result.suggestions.find((s) => s.source === 'fit')
        : undefined
    const guess = (fitPick ?? result.suggestions[0]).word

    const rank = rankOf.get(guess)
    if (rank !== undefined) {
      everGotTop300 = true
      if (rank === 1) {
        return { secret, solved: true, turns: turn, enteredExploitAtTurn, everGotTop300, informativeAtSolve: informativeCount }
      }
      state = { ...state, observations: [...state.observations, { word: guess, feedback: { kind: 'rank', rank } }] }
    } else {
      state = { ...state, rejected: [...state.rejected, guess] }
    }
  }
  return { secret, solved: false, turns: null, enteredExploitAtTurn, everGotTop300, informativeAtSolve: null }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function summariseClosedLoop(results: ClosedLoopResult[]): string {
  const solved = results.filter((r) => r.solved)
  const turns = solved.map((r) => r.turns!)
  const neverTop300 = results.filter((r) => !r.everGotTop300).length
  const enteredExploit = results.filter((r) => r.enteredExploitAtTurn !== null)
  const exploitTurns = enteredExploit.map((r) => r.enteredExploitAtTurn!)
  const infAtSolve = solved.map((r) => r.informativeAtSolve!)
  const turnsSorted = [...turns].sort((a, b) => a - b)
  return (
    `${solved.length}/${results.length} solved` +
    (turns.length ? ` (median ${median(turns)} turns, min ${turnsSorted[0]}, max ${turnsSorted[turnsSorted.length - 1]})` : '') +
    `; ${results.length - solved.length} never solved (${neverTop300} of which never got a guess in the secret's top-300)` +
    `; ${enteredExploit.length}/${results.length} ever entered exploit (median turn ${median(exploitTurns) ?? 'n/a'})` +
    `; median ${median(infAtSolve) ?? 'n/a'} informative observations held at solve time`
  )
}

// Both `threshold` and `closed-loop` need the profile + probe ladder.
let cachedProfile: ProviderProfile | undefined
let cachedLadder: string[] | undefined
function loadProfileAndLadder(): { profile: ProviderProfile; ladder: string[] } {
  if (!cachedProfile || !cachedLadder) {
    const profiles = parseProfiles(readFileSync(join(HERE, 'dict/assets/profiles.json'), 'utf8'))
    const profile = profiles.get('contextno-ru')
    if (!profile) throw new Error('contextno-ru profile missing from dict/assets/profiles.json')
    const ladderAsset = parseProbeLadder(readFileSync(join(HERE, 'dict/assets/ru.probes.json'), 'utf8'))
    assertProbeLadderMatches(ladderAsset, vs.hash)
    cachedProfile = profile
    cachedLadder = ladderAsset.probes
  }
  return { profile: cachedProfile, ladder: cachedLadder }
}

// ---------------------------------------------------------------------------
// Finding 4: exploreThreshold sweep. Requires the `lambda` schedule to already
// be calibrated and committed to dict/assets/profiles.json — this section
// loads that file, so re-run `--section lambda` first, update profiles.json,
// and only then trust this section's numbers.
// ---------------------------------------------------------------------------
if (sections.has('threshold')) {
  console.log("\n=== Finding 4: exploreThreshold sweep (tuning split only) ===")
  // The gold fixture only reveals ranks up to 300 (контекстно.рф's /first-words
  // captures each secret's top-300 neighbours, spec §2.1) — any guess outside
  // that band has no discoverable rank at all in this harness, so every
  // threshold >=300 is structurally indistinguishable from 300 here (a real
  // rank of, say, 4000 can never be observed as "4000 <= 1000? no" vs "4000 <=
  // 2000? no" -- it is simply invisible). The grid below spans both sides of
  // that cap: values below 300 to find where the fixture *can* discriminate,
  // plus the spec-suggested 300/500/1000/2000 to confirm and document that
  // they are indeed equivalent under this methodology.
  const THRESHOLD_GRID = [50, 100, 150, 200, 250, 300, 500, 1000, 2000]
  const MAX_TURNS = 80
  const { profile: baseProfile, ladder } = loadProfileAndLadder()

  let bestThreshold = { threshold: baseProfile.exploreThreshold, solved: -1, med: Infinity }
  for (const threshold of THRESHOLD_GRID) {
    const profile: ProviderProfile = { ...baseProfile, exploreThreshold: threshold }
    const results = tune.map((secret) => simulatePuzzle(secret, profile, ladder, MAX_TURNS, 'top1'))
    const solvedCount = results.filter((r) => r.solved).length
    const med = median(results.filter((r) => r.solved).map((r) => r.turns!)) ?? Infinity
    console.log(`  tune threshold=${threshold}: ${summariseClosedLoop(results)}`)
    if (solvedCount > bestThreshold.solved || (solvedCount === bestThreshold.solved && med < bestThreshold.med)) {
      bestThreshold = { threshold, solved: solvedCount, med }
    }
  }
  console.log(`\nchosen exploreThreshold (tuning split): ${bestThreshold.threshold}`)

  if (bestThreshold.threshold !== baseProfile.exploreThreshold) {
    const shippedResults = heldOut.map((secret) => simulatePuzzle(secret, baseProfile, ladder, MAX_TURNS, 'top1'))
    console.log(`held-out performance of the previously-shipped exploreThreshold=${baseProfile.exploreThreshold} (for comparison):`)
    console.log(`  ${summariseClosedLoop(shippedResults)}`)
  }

  const chosenProfile: ProviderProfile = { ...baseProfile, exploreThreshold: bestThreshold.threshold }
  const heldOutResults = heldOut.map((secret) => simulatePuzzle(secret, chosenProfile, ladder, MAX_TURNS, 'top1'))
  console.log(`held-out performance of exploreThreshold=${bestThreshold.threshold}:`)
  console.log(`  ${summariseClosedLoop(heldOutResults)}`)
}

// ---------------------------------------------------------------------------
// Closed-loop headline (BENCHMARKS.md): all 40 gold secrets, shipped profile.
// ---------------------------------------------------------------------------
if (sections.has('closed-loop')) {
  console.log('\n=== closed-loop simulation: all 40 gold secrets, shipped profile ===')
  const { profile, ladder } = loadProfileAndLadder()
  const MAX_TURNS = 150
  const results = secrets.map((secret) => simulatePuzzle(secret, profile, ladder, MAX_TURNS, 'prefer-fit'))
  console.log(summariseClosedLoop(results))
  const unsolved = results.filter((r) => !r.solved).map((r) => r.secret)
  if (unsolved.length) console.log(`  never solved: ${unsolved.join(', ')}`)
}

// ---------------------------------------------------------------------------
// Probe-ladder validation (spec §6.3). A probe's rank for a secret is its
// position in that secret's own gold top-300 list, or "outside 300" if absent.
// There is no lambda and no tune/held-out split: the metric doesn't touch
// scoreCandidates at all, so every one of the 40 gold secrets is used.
// ---------------------------------------------------------------------------
if (sections.has('ladder')) {
  console.log('\n=== probe ladder vs random baseline ===')

  const ladderAsset = parseProbeLadder(readFileSync(join(HERE, 'dict/assets/ru.probes.json'), 'utf8'))
  assertProbeLadderMatches(ladderAsset, vs.hash)
  const ladder = ladderAsset.probes
  const LADDER_KS = [5, 10, 20, 30, 40]
  const allSecrets = Object.keys(gold).map(normalizeWord)

  /** Best (lowest) rank any of `probes` achieves in `list` (secret's own gold order), or Infinity. */
  function bestRank(list: string[], probes: string[]): number {
    const rankOf = new Map<string, number>()
    list.forEach((w, i) => rankOf.set(normalizeWord(w), i + 1))
    let best = Infinity
    for (const probe of probes) {
      const r = rankOf.get(probe)
      if (r !== undefined && r < best) best = r
    }
    return best
  }

  /** Fraction of secrets for which some probe among the first k lands in the top-300, per k. */
  function hitRates(probeWords: string[]): Map<number, number> {
    const out = new Map<number, number>()
    for (const k of LADDER_KS) {
      let hits = 0
      for (const secret of allSecrets) {
        const probes = nextProbes(probeWords, new Set(), k)
        if (bestRank(gold[secret], probes) <= 300) hits++
      }
      out.set(k, hits / allSecrets.length)
    }
    return out
  }

  const ladderRates = hitRates(ladder)
  console.log(`ladder (${ladder.length} probes): ${ladder.slice(0, 10).join(', ')}, ...`)

  // Random baseline: same candidate pool the ladder was built from (common,
  // concrete nouns — mirrors bin/build-probes.ts; keep these three constants in
  // sync if that filter changes), averaged over several mulberry32-seeded draws.
  const HARRIX = join(ROOT, 'packages', 'solver-core', 'dict', 'raw', 'russian_nouns.txt')
  const CANDIDATES = 6000
  // Keep in sync with the (extended) ABSTRACT regex in bin/build-probes.ts.
  const ABSTRACT =
    /(ость|ение|ание|изм|ция|ство|тие|ика|ура|ота|изна|щина|ирование|ация|гия|фия|метрия|номия|отка|овка|евка)$/
  const common = new Set(readFileSync(HARRIX, 'utf8').split('\n').map(normalizeWord).filter((w) => w !== ''))
  const candidatePool: string[] = []
  for (let i = 0; i < Math.min(CANDIDATES, vs.words.length); i++) {
    const w = vs.words[i]
    if (w.length >= 4 && !ABSTRACT.test(w) && common.has(w)) candidatePool.push(w)
  }
  console.log(`random-baseline candidate pool: ${candidatePool.length} common concrete nouns`)

  function pickDistinct(rng: () => number, count: number, poolSize: number): number[] {
    const chosen = new Set<number>()
    while (chosen.size < count) chosen.add(Math.floor(rng() * poolSize))
    return [...chosen]
  }

  const DRAWS = 20
  const totals = new Map<number, number>(LADDER_KS.map((k) => [k, 0]))
  for (let d = 0; d < DRAWS; d++) {
    const rng = mulberry32(9000 + d)
    const drawn = pickDistinct(rng, Math.min(40, candidatePool.length), candidatePool.length).map((i) => candidatePool[i])
    const rates = hitRates(drawn)
    for (const k of LADDER_KS) totals.set(k, totals.get(k)! + rates.get(k)!)
  }

  console.log(`\n${'k'.padStart(4)}${'ladder'.padStart(10)}${'random (avg of ' + DRAWS + ')'.padStart(24)}`)
  for (const k of LADDER_KS) {
    const l = (ladderRates.get(k)! * 100).toFixed(0)
    const r = ((totals.get(k)! / DRAWS) * 100).toFixed(0)
    console.log(`${String(k).padStart(4)}${(l + '%').padStart(10)}${(r + '%').padStart(24)}`)
  }
}
