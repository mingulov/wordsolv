/** CLI: npx tsx bin/build-book.ts --config all */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { MOVE1_MAX_LEN, serializeMove0, serializeMove1 } from '../src/book'
import { parseDictAsset } from '../src/dictionary'
import { entropyOf, weightsFor } from '../src/entropy'
import { scoreGuess } from '../src/pattern'
import openersJson from '../src/openers.json' with { type: 'json' }

const ALL = ['ru-4', 'ru-5', 'ru-6', 'ru-7', 'ru-8', 'en-4', 'en-5', 'en-6', 'en-7', 'en-8']

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}

const configArg = arg('config', 'all')
const configs = configArg === 'all' ? ALL : [configArg]
const assets = join(import.meta.dirname, '..', 'dict', 'assets')
const manifestPath = join(assets, 'books.json')

const manifest: Record<string, { m0: boolean; m1: boolean }> =
  configArg === 'all' || !existsSync(manifestPath)
    ? {}
    : (JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest)

for (const cfg of configs) {
  const [lang, lenS] = cfg.split('-')
  const dict = parseDictAsset(readFileSync(join(assets, `${cfg}.txt`), 'utf8'))
  const t1 = dict.words.slice(0, dict.t1Count)
  const w = weightsFor(t1, dict)

  const t0 = performance.now()
  const values = new Float64Array(dict.words.length)
  for (let g = 0; g < dict.words.length; g++) values[g] = entropyOf(dict.words[g], t1, w)
  const buf = serializeMove0(dict, values)
  writeFileSync(join(assets, `${cfg}.m0.bin`), Buffer.from(buf))

  console.log(
    `${cfg}: m0 n=${dict.words.length} ${(buf.byteLength / 1024).toFixed(0)}KB ` +
    `in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  )

  let m1 = false
  if (Number(lenS) <= MOVE1_MAX_LEN) {
    const openers = openersJson as Record<string, string[]>
    // Prefer the committed opener; otherwise the word the solver would play at move 0.
    let w0 = openers[`${lang}-${lenS}x4`]?.[0]
    if (!w0) {
      let best = 0
      for (let g = 1; g < values.length; g++) if (values[g] > values[best]) best = g
      w0 = dict.words[best]
    }
    const openerIdx = dict.index.get(w0)
    if (openerIdx === undefined) throw new Error(`${cfg}: opener "${w0}" is not in the dictionary`)

    const byPattern = new Map<number, string[]>()
    for (const word of t1) {
      const p = scoreGuess(w0, word)
      const arr = byPattern.get(p)
      if (arr) arr.push(word)
      else byPattern.set(p, [word])
    }
    const patterns = [...byPattern.keys()]
    // Runtime `bookLookup` accepts a row on the strength of (openerIdx, pattern) alone; it
    // assumes every emitted row was built from a non-empty T1 candidate set. Verify that
    // here rather than trusting the Map-construction invariant silently.
    for (const p of patterns) {
      const cands = byPattern.get(p)
      if (!cands || cands.length === 0) {
        throw new Error(`${cfg}: pattern ${p} for opener "${w0}" has an empty T1 candidate bucket`)
      }
    }
    const n = dict.words.length
    const vals = new Float32Array(patterns.length * n)
    const t1s = performance.now()
    for (let pi = 0; pi < patterns.length; pi++) {
      const cands = byPattern.get(patterns[pi])!
      const cw = weightsFor(cands, dict)
      for (let g = 0; g < n; g++) vals[pi * n + g] = entropyOf(dict.words[g], cands, cw)
    }
    const gz = gzipSync(Buffer.from(serializeMove1(dict, openerIdx, patterns, vals)), { level: 9 })
    writeFileSync(join(assets, `${cfg}.m1.bin.gz`), gz)
    m1 = true
    console.log(
      `${cfg}: m1 opener=${w0} patterns=${patterns.length} ` +
      `${(gz.length / 2 ** 20).toFixed(1)}MB gz in ${((performance.now() - t1s) / 1000).toFixed(0)}s`,
    )
  }

  manifest[cfg] = { m0: true, m1 }
}

const ordered: typeof manifest = {}
for (const k of ALL) if (manifest[k]) ordered[k] = manifest[k]
writeFileSync(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`)
console.log(`wrote ${manifestPath}`)
