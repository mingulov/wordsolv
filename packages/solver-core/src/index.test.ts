import { describe, expect, it } from 'vitest'
import { VERSION } from './index'

describe('package smoke', () => {
  it('exports a version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
