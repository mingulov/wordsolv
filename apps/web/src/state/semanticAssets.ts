/** URLs for the semantic-core assets, always relative to the deploy base. */
export function semanticAssetUrls(): { vectors: string; probes: string; profiles: string } {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return {
    vectors: `${base}semantic/ru.vec.bin`,
    probes: `${base}semantic/ru.probes.json`,
    profiles: `${base}semantic/profiles.json`,
  }
}
