// Copies dictionary assets + SOURCES.md from solver-core into public/dict/.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
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

// Semantic-core assets -> public/semantic/. ru.vec.bin is ~27.5 MB and is served
// at runtime only (never precached) — see runtimeCaching in vite.config.ts.
const semDict = join(here, '..', '..', '..', 'packages', 'semantic-core', 'dict', 'assets')
const semOut = join(here, '..', 'public', 'semantic')
if (existsSync(semDict)) {
  mkdirSync(semOut, { recursive: true })
  let m = 0
  for (const f of readdirSync(semDict)) {
    copyFileSync(join(semDict, f), join(semOut, f))
    m++
  }
  console.log(`copied ${m} semantic assets to public/semantic/`)
} else {
  console.warn(
    'semantic-core assets missing — run: npx tsx bin/build-vectors.ts && npx tsx bin/build-probes.ts (from packages/semantic-core)',
  )
}
