export const VECTOR_ASSET_VERSION = 1

export interface VectorSet {
  words: string[]
  index: Map<string, number>
  dim: number
  data: Int8Array
  scale: Float32Array
  hash: string
}

/**
 * djb2 over the word list only (order + spelling) — detects lexicon drift,
 * mirroring the opening book's dictHash.
 *
 * Limitation: this hash is a function of `words` alone; it never reads `rows`
 * or `dim`. Two `ru.vec.bin` builds that share the identical word list but
 * differ in the embedding *values* — a re-quantisation of the same source
 * vectors, or a differently-trained embedding fit over the same lexicon —
 * produce the exact same hash. Consumers that compare hashes (`VectorSet.hash`,
 * `ProbeLadder.dictHash`) can therefore only detect "the word list changed,"
 * never "the vectors changed under an unchanged word list."
 */
function hashWords(words: string[]): string {
  let h = 5381
  for (const word of words) {
    for (let i = 0; i < word.length; i++) h = ((h * 33) ^ word.charCodeAt(i)) >>> 0
    h = ((h * 33) ^ 10) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function serializeVectors(words: string[], rows: Float32Array, dim: number): Uint8Array {
  const count = words.length
  if (rows.length !== count * dim) throw new Error('rows length does not match words * dim')

  const scale = new Float32Array(dim)
  for (let d = 0; d < dim; d++) {
    let max = 0
    for (let i = 0; i < count; i++) max = Math.max(max, Math.abs(rows[i * dim + d]))
    scale[d] = max === 0 ? 1 : max / 127
  }

  const quant = new Int8Array(count * dim)
  for (let i = 0; i < count * dim; i++) {
    const d = i % dim
    const q = Math.round(rows[i] / scale[d])
    quant[i] = Math.max(-127, Math.min(127, q))
  }

  const header = `semvec ${VECTOR_ASSET_VERSION} ${count} ${dim} ${hashWords(words)}\n`
  const text = new TextEncoder().encode(header + words.join('\n') + '\n')
  const out = new Uint8Array(text.length + dim * 4 + quant.length)
  out.set(text, 0)
  const scaleView = new DataView(out.buffer, text.length, dim * 4)
  for (let d = 0; d < dim; d++) scaleView.setFloat32(d * 4, scale[d], true)
  out.set(new Uint8Array(quant.buffer), text.length + dim * 4)
  return out
}

/**
 * Decodes a `semvec` asset (see `serializeVectors`) into a `VectorSet`.
 *
 * `VectorSet.data` is a **zero-copy `Int8Array` view over `bytes`'s own
 * `ArrayBuffer`** (`Int8Array` has no alignment constraint, so this avoids
 * doubling peak memory on the full ~26 MB production asset) — it is not a copy.
 * Keep `bytes`'s backing buffer alive for as long as the returned `VectorSet` is
 * used; a shorter-lived buffer leaves `data` reading freed or reused memory. This
 * matters most for a planned Web Worker caller that does `fetch(...).then(r =>
 * r.arrayBuffer())`: if that buffer is ever `postMessage`d elsewhere as a
 * transferable (rather than retained), it is detached and `data` becomes invalid
 * even though the `VectorSet` object itself still exists.
 */
export function parseVectors(bytes: Uint8Array): VectorSet {
  const decoder = new TextDecoder()
  const nl = bytes.indexOf(10)
  if (nl < 0) throw new Error('vector asset truncated: no header')
  const header = decoder.decode(bytes.subarray(0, nl)).split(' ')
  if (header[0] !== 'semvec') throw new Error('not a semvec asset')
  if (Number(header[1]) !== VECTOR_ASSET_VERSION)
    throw new Error(`unsupported semvec version ${header[1]}`)
  const count = Number(header[2])
  const dim = Number(header[3])
  const hash = header[4]
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`invalid semvec count ${header[2]}`)
  if (!Number.isSafeInteger(dim) || dim < 0) throw new Error(`invalid semvec dim ${header[3]}`)
  if (hash === undefined) throw new Error('vector asset truncated: incomplete header')

  let pos = nl + 1
  const words: string[] = []
  const index = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    const end = bytes.indexOf(10, pos)
    if (end < 0) throw new Error('vector asset truncated: word list')
    const word = decoder.decode(bytes.subarray(pos, end))
    index.set(word, i)
    words.push(word)
    pos = end + 1
  }

  if (bytes.length < pos + dim * 4 + count * dim) throw new Error('vector asset truncated: payload')
  const scale = new Float32Array(dim)
  const view = new DataView(bytes.buffer, bytes.byteOffset + pos, dim * 4)
  for (let d = 0; d < dim; d++) scale[d] = view.getFloat32(d * 4, true)
  pos += dim * 4
  // Zero-copy view over the payload — Int8Array has no alignment constraint, so
  // this avoids doubling peak memory on the full ~26MB production asset.
  const data = new Int8Array(bytes.buffer, bytes.byteOffset + pos, count * dim)

  return { words, index, dim, data, scale, hash }
}

/** Cosine similarity of every word to word `i`, written into `out`. */
export function similarityTo(vs: VectorSet, i: number, out: Float32Array): Float32Array {
  const { dim, data, scale } = vs
  const count = vs.words.length
  const probe = new Float32Array(dim)
  let pn = 0
  for (let d = 0; d < dim; d++) {
    const v = data[i * dim + d] * scale[d]
    probe[d] = v
    pn += v * v
  }
  pn = Math.sqrt(pn) || 1

  for (let c = 0; c < count; c++) {
    let dot = 0
    let n = 0
    const base = c * dim
    for (let d = 0; d < dim; d++) {
      const v = data[base + d] * scale[d]
      dot += v * probe[d]
      n += v * v
    }
    out[c] = dot / ((Math.sqrt(n) || 1) * pn)
  }
  return out
}
