/// <reference lib="webworker" />
import {
  RankCache, assertProbeLadderMatches, parseProbeLadder, parseProfiles, parseSuggestable, parseVectors, suggest,
  type ProviderProfile, type SuggestableMask, type VectorSet,
} from '@wordsolv/semantic-core'
import type { SemanticReply, SemanticRequest } from './semanticProtocol'

interface Loaded {
  vectors: VectorSet
  /**
   * Held so the zero-copy `Int8Array` view inside `vectors.data` stays valid
   * for the worker's whole lifetime — `parseVectors` never copies the
   * payload bytes. Never transfer or drop this reference.
   */
  raw: Uint8Array
  ladder: string[]
  profile: ProviderProfile
  cache: RankCache
  suggestable: SuggestableMask
}

// Module-scoped so the parsed VectorSet/ladder/profile/RankCache survive
// across every request this worker instance ever handles — loading the
// 27.5 MB vector asset per keystroke would be unusable. `loading` guards a
// concurrent second request from starting a second fetch+parse while the
// first is still in flight: it is assigned synchronously (before the first
// `await`), so a message that arrives while a load is already underway sees
// it set and just awaits the same promise instead of calling `load` again.
let loaded: Loaded | null = null
let loading: Promise<Loaded> | null = null
let latest = 0

async function load(urls: SemanticRequest['urls'], providerId: string): Promise<Loaded> {
  const [vecRes, probRes, profRes, suggestableRes] = await Promise.all([
    fetch(urls.vectors),
    fetch(urls.probes),
    fetch(urls.profiles),
    fetch(urls.suggestable),
  ])
  if (!vecRes.ok || !probRes.ok || !profRes.ok || !suggestableRes.ok)
    throw new Error('failed to fetch semantic assets')

  const raw = new Uint8Array(await vecRes.arrayBuffer())
  const vectors = parseVectors(raw)

  const ladder = parseProbeLadder(await probRes.text())
  // Fails loudly on a lexicon mismatch between the two independently
  // regenerable, gitignored assets, rather than silently scoring against the
  // wrong word list.
  assertProbeLadderMatches(ladder, vectors.hash)

  const profile = parseProfiles(await profRes.text()).get(providerId)
  if (!profile) throw new Error(`unknown provider "${providerId}"`)

  const suggestable = parseSuggestable(new Uint8Array(await suggestableRes.arrayBuffer()))
  // Same lexicon-drift guard as the probe ladder above: both assets are
  // gitignored and independently regenerable, so a mask built against a
  // since-changed word list must fail loudly rather than silently suppress
  // (or fail to suppress) the wrong indices.
  if (suggestable.dictHash !== vectors.hash) {
    throw new Error(
      `suggestable mask dictHash "${suggestable.dictHash}" does not match the loaded vector asset's word-list hash "${vectors.hash}" ` +
        `— the mask was built against a different word list; regenerate with "python3 bin/build-candidates.py"`,
    )
  }

  return {
    vectors, raw, ladder: ladder.probes, profile, suggestable,
    cache: new RankCache(vectors, profile.rankUniverse),
  }
}

function post(reply: SemanticReply): void {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(reply)
}

self.onmessage = async (e: MessageEvent<SemanticRequest>) => {
  const req = e.data
  latest = req.id
  try {
    if (!loaded) {
      post({ id: req.id, loading: 'assets' })
      loading ??= load(req.urls, req.state.providerId)
      loaded = await loading
    }
    if (req.id !== latest) return // a newer request arrived while this one was loading assets

    const result = suggest({
      state: req.state,
      vectors: loaded.vectors,
      profile: loaded.profile,
      ladder: loaded.ladder,
      cache: loaded.cache,
      suggestable: loaded.suggestable,
      limit: req.limit,
    })
    if (req.id !== latest) return // a newer request arrived while this one was scoring

    post({ id: req.id, result })
  } catch (err) {
    loading = null // let a later request retry after a failed load
    post({ id: req.id, error: err instanceof Error ? err.message : String(err) })
  }
}
