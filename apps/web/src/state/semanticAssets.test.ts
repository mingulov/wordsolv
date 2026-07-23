import { afterEach, describe, expect, it, vi } from 'vitest'
import { semanticAssetUrls } from './semanticAssets'

describe('semanticAssetUrls', () => {
  it('builds every url under the deploy base', () => {
    const u = semanticAssetUrls()
    for (const url of Object.values(u)) expect(url.startsWith(import.meta.env.BASE_URL)).toBe(true)
  })

  it('points at the semantic asset filenames', () => {
    const u = semanticAssetUrls()
    expect(u.vectors).toMatch(/ru\.vec\.bin$/)
    expect(u.probes).toMatch(/ru\.probes\.json$/)
    expect(u.profiles).toMatch(/profiles\.json$/)
    expect(u.suggestable).toMatch(/ru\.suggestable\.bin$/)
  })

  it('never yields a double slash', () => {
    for (const url of Object.values(semanticAssetUrls())) expect(url).not.toMatch(/[^:]\/\//)
  })

  describe('with a non-root deploy base', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('honors a project-site base like /wordsolv/ rather than a hardcoded leading slash', () => {
      vi.stubEnv('BASE_URL', '/wordsolv/')
      const u = semanticAssetUrls()
      for (const url of Object.values(u)) {
        expect(url.startsWith('/wordsolv/')).toBe(true)
      }
      expect(u.vectors).toBe('/wordsolv/semantic/ru.vec.bin')
      expect(u.suggestable).toBe('/wordsolv/semantic/ru.suggestable.bin')
    })
  })
})
