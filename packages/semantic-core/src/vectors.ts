export const VECTOR_ASSET_VERSION = 1

export interface VectorSet {
  words: string[]
  index: Map<string, number>
  dim: number
  data: Int8Array
  scale: Float32Array
  hash: string
}

/** djb2 over the word list — detects lexicon drift, mirroring the opening book's dictHash. */
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
  new Uint8Array(new Float32Array(scale).buffer).forEach((b, i) => { out[text.length + i] = b })
  out.set(new Uint8Array(quant.buffer), text.length + dim * 4)
  return out
}

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
  const data = new Int8Array(bytes.buffer.slice(bytes.byteOffset + pos, bytes.byteOffset + pos + count * dim))

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
