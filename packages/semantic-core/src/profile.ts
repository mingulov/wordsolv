import type { ProviderProfile } from './types'

export function parseProfiles(json: string): Map<string, ProviderProfile> {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('profiles must be a JSON array')
  const out = new Map<string, ProviderProfile>()
  for (const entry of parsed) {
    const p = entry as Partial<ProviderProfile>
    if (typeof p.id !== 'string' || p.id === '') throw new Error('profile id must be a non-empty string')
    if (out.has(p.id)) throw new Error(`duplicate profile id "${p.id}"`)
    if (p.language !== 'ru' && p.language !== 'en') throw new Error(`profile "${p.id}": language must be ru or en`)
    if (p.feedback !== 'rank' && p.feedback !== 'similarity')
      throw new Error(`profile "${p.id}": feedback must be rank or similarity`)
    if (typeof p.rankUniverse !== 'number' || !Number.isInteger(p.rankUniverse) || p.rankUniverse <= 0)
      throw new Error(`profile "${p.id}": rankUniverse must be a positive integer`)
    if (typeof p.priorLambda !== 'number' || !(p.priorLambda >= 0))
      throw new Error(`profile "${p.id}": priorLambda must be >= 0`)
    if (typeof p.exploreThreshold !== 'number' || !Number.isInteger(p.exploreThreshold) || p.exploreThreshold <= 0)
      throw new Error(`profile "${p.id}": exploreThreshold must be a positive integer`)
    const lex = p.lexicon
    if (!lex || (lex.pos !== 'noun' && lex.pos !== 'any'))
      throw new Error(`profile "${p.id}": lexicon.pos must be noun or any`)
    if (typeof lex.lemmaOnly !== 'boolean')
      throw new Error(`profile "${p.id}": lexicon.lemmaOnly must be a boolean`)
    if (typeof lex.foldYo !== 'boolean')
      throw new Error(`profile "${p.id}": lexicon.foldYo must be a boolean`)
    out.set(p.id, p as ProviderProfile)
  }
  return out
}
