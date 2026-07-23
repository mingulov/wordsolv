/** Compiles araneum into dict/assets/ru.vec.bin. Run: npx tsx bin/build-vectors.ts */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { createGunzip } from 'node:zlib'
import { normalizeWord } from '../src/types'
import { serializeVectors } from '../src/vectors'

const HERE = join(import.meta.dirname, '..', 'dict')
const CYRILLIC = /^[а-я-]+$/
const DIM = 300
const MIN_LEN = 2

async function main(): Promise<void> {
  const words: string[] = []
  const chunks: number[][] = []
  const seen = new Set<string>()

  const stream = createReadStream(join(HERE, 'raw', 'araneum.vec.gz')).pipe(createGunzip())
  const lines = createInterface({ input: stream, crlfDelay: Infinity })

  let first = true
  for await (const line of lines) {
    if (first) { first = false; continue }               // "<count> <dim>" header
    const space = line.indexOf(' ')
    const token = line.slice(0, space)
    if (!token.endsWith('_NOUN')) continue
    const word = normalizeWord(token.slice(0, -'_NOUN'.length))
    if (word.length < MIN_LEN || !CYRILLIC.test(word) || seen.has(word)) continue
    const values = line.slice(space + 1).split(' ')
    if (values.length !== DIM) continue
    seen.add(word)
    words.push(word)
    chunks.push(values.map(Number))
  }

  // araneum emits in descending corpus frequency, so file order IS the frequency prior.
  const rows = new Float32Array(words.length * DIM)
  chunks.forEach((vec, i) => {
    let norm = 0
    for (const v of vec) norm += v * v
    norm = Math.sqrt(norm) || 1
    for (let d = 0; d < DIM; d++) rows[i * DIM + d] = vec[d] / norm
  })

  if (words.length < 30000)
    throw new Error(`only ${words.length} noun lemmas — expected >30000; check the raw input`)

  mkdirSync(join(HERE, 'assets'), { recursive: true })
  const bytes = serializeVectors(words, rows, DIM)
  writeFileSync(join(HERE, 'assets', 'ru.vec.bin'), bytes)
  console.log(`ru.vec.bin: ${words.length} words, ${(bytes.length / 1e6).toFixed(1)} MB`)
}

await main()
