// Copies dictionary assets + SOURCES.md from solver-core into public/dict/.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dict = join(here, '..', '..', '..', 'packages', 'solver-core', 'dict')
const out = join(here, '..', 'public', 'dict')
mkdirSync(out, { recursive: true })
let n = 0
for (const f of readdirSync(join(dict, 'assets'))) {
  copyFileSync(join(dict, 'assets', f), join(out, f))
  n++
}
copyFileSync(join(dict, 'SOURCES.md'), join(out, 'SOURCES.md'))
console.log(`copied ${n} dictionary assets + SOURCES.md to public/dict/`)
