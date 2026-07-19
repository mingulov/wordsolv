// Generates icon-192.png and icon-512.png (maskable): green background, 2x2 white tile grid.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const GREEN = [0x6a, 0xaa, 0x64, 255]
const WHITE = [255, 255, 255, 255]
const YELLOW = [0xc9, 0xb4, 0x58, 255]

function draw(size) {
  const u = size / 12 // layout unit; tiles occupy the middle 8 units
  const tile = (x, y, tx, ty) =>
    x >= u * (2 + tx * 4.5) && x < u * (5.5 + tx * 4.5) && y >= u * (2 + ty * 4.5) && y < u * (5.5 + ty * 4.5)
  return png(size, (x, y) => {
    if (tile(x, y, 0, 0) || tile(x, y, 1, 1)) return WHITE
    if (tile(x, y, 1, 0)) return YELLOW
    if (tile(x, y, 0, 1)) return WHITE
    return GREEN
  })
}

const here = dirname(fileURLToPath(import.meta.url))
for (const size of [192, 512]) {
  writeFileSync(join(here, '..', 'public', `icon-${size}.png`), draw(size))
  console.log(`icon-${size}.png written`)
}
