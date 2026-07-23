import type { SemanticResult, SemanticState } from '@wordsolv/semantic-core'

export interface SemanticAssetUrls {
  vectors: string
  probes: string
  profiles: string
}

export interface SemanticRequest {
  id: number
  state: SemanticState
  limit: number
  urls: SemanticAssetUrls
}

export interface SemanticReply {
  id: number
  result?: SemanticResult
  error?: string
  loading?: 'assets'
}
