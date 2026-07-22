/** CLI: npx tsx bin/build-book.ts --config all */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MOVE1_MAX_LEN, serializeMove0 } from '../src/book'
import { parseDictAsset } from '../src/dictionary'
import { entropyOf, weightsFor } from '../src/entropy'

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
  configArg === 'all' ? {} : (JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest)

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

  manifest[cfg] = { m0: true, m1: Number(lenS) <= MOVE1_MAX_LEN }
  console.log(
    `${cfg}: m0 n=${dict.words.length} ${(buf.byteLength / 1024).toFixed(0)}KB ` +
    `in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  )
}

const ordered: typeof manifest = {}
for (const k of ALL) if (manifest[k]) ordered[k] = manifest[k]
writeFileSync(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`)
console.log(`wrote ${manifestPath}`)
