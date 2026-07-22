import type { Dictionary } from './dictionary'
import { djb2 } from './random'

/** Word lengths that get a move-1 book. Longer configs are entropy-cheap at move 1. */
export const MOVE1_MAX_LEN = 6
export const BOOK_VERSION = 1

const M0_HEADER = 24 // 20 bytes of fields + 4 pad, so f64 values start 8-aligned
const M1_HEADER = 24

export interface Move1Book {
  /** Dictionary index of the opener this book was built for. */
  openerIdx: number
  /** Pattern id -> row index into `values`. */
  rowOf: Map<number, number>
  /** patternCount x n, row-major by pattern. */
  values: Float32Array
  n: number
}

export interface OpeningBook {
  dictHash: number
  move0: Float64Array
  move1: Move1Book | null
}

export function dictHashOf(dict: Dictionary): number {
  return djb2(dict.words.join('\n'))
}

function writeHeader(view: DataView, magic: string, dict: Dictionary): void {
  for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i))
  view.setUint8(4, BOOK_VERSION)
  view.setUint8(5, dict.language.charCodeAt(0))
  view.setUint8(6, dict.wordLength)
  view.setUint8(7, 0)
  view.setUint32(8, dictHashOf(dict), true)
}

/** Validates magic/version/lang/length/hash. Returns false for any mismatch. */
function checkHeader(buf: ArrayBuffer, magic: string, dict: Dictionary, minBytes: number): boolean {
  if (buf.byteLength < minBytes) return false
  const view = new DataView(buf)
  for (let i = 0; i < 4; i++) if (view.getUint8(i) !== magic.charCodeAt(i)) return false
  if (view.getUint8(4) !== BOOK_VERSION) return false
  if (view.getUint8(5) !== dict.language.charCodeAt(0)) return false
  if (view.getUint8(6) !== dict.wordLength) return false
  return view.getUint32(8, true) === dictHashOf(dict)
}

export function serializeMove0(dict: Dictionary, values: Float64Array): ArrayBuffer {
  const buf = new ArrayBuffer(M0_HEADER + values.length * 8)
  const view = new DataView(buf)
  writeHeader(view, 'WSM0', dict)
  view.setUint32(12, values.length, true)
  view.setUint32(16, dict.t1Count, true)
  new Float64Array(buf, M0_HEADER, values.length).set(values)
  return buf
}

export function parseMove0(buf: ArrayBuffer, dict: Dictionary): Float64Array | null {
  if (!checkHeader(buf, 'WSM0', dict, M0_HEADER)) return null
  const view = new DataView(buf)
  const n = view.getUint32(12, true)
  if (n !== dict.words.length) return null
  if (view.getUint32(16, true) !== dict.t1Count) return null
  if (buf.byteLength < M0_HEADER + n * 8) return null
  return new Float64Array(buf, M0_HEADER, n)
}

/** Byte offset of the f32 value block: header + u16 patterns, rounded up to a multiple of 4. */
function m1ValuesOffset(patternCount: number): number {
  const afterPatterns = M1_HEADER + patternCount * 2
  return afterPatterns + (afterPatterns % 4)
}

export function serializeMove1(
  dict: Dictionary,
  openerIdx: number,
  patterns: number[],
  values: Float32Array,
): ArrayBuffer {
  const off = m1ValuesOffset(patterns.length)
  const buf = new ArrayBuffer(off + values.length * 4)
  const view = new DataView(buf)
  writeHeader(view, 'WSM1', dict)
  view.setUint32(12, dict.words.length, true)
  view.setUint32(16, patterns.length, true)
  view.setUint32(20, openerIdx, true)
  for (let i = 0; i < patterns.length; i++) view.setUint16(M1_HEADER + i * 2, patterns[i], true)
  new Float32Array(buf, off, values.length).set(values)
  return buf
}

export function parseMove1(buf: ArrayBuffer, dict: Dictionary): Move1Book | null {
  if (!checkHeader(buf, 'WSM1', dict, M1_HEADER)) return null
  const view = new DataView(buf)
  const n = view.getUint32(12, true)
  if (n !== dict.words.length) return null
  const patternCount = view.getUint32(16, true)
  const openerIdx = view.getUint32(20, true)
  if (openerIdx >= n) return null
  const off = m1ValuesOffset(patternCount)
  if (buf.byteLength < off + patternCount * n * 4) return null
  const rowOf = new Map<number, number>()
  for (let i = 0; i < patternCount; i++) rowOf.set(view.getUint16(M1_HEADER + i * 2, true), i)
  return { openerIdx, rowOf, values: new Float32Array(buf, off, patternCount * n), n }
}
