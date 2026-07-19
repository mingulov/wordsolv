// Test-only stand-in for 'virtual:pwa-register/react'. That specifier is a
// virtual module vite-plugin-pwa registers only inside a real Vite dev/build
// pipeline; vitest.config.ts intentionally omits VitePWA (it's a build/deploy
// concern, not app logic under test), so the bare specifier can't be resolved
// there. vitest.config.ts aliases 'virtual:pwa-register/react' to this file so
// any test that renders App (and therefore UpdateToast) still works, always
// reporting "no update pending".
export function useRegisterSW(): {
  needRefresh: [boolean, (v: boolean) => void]
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>
} {
  return {
    needRefresh: [false, () => {}],
    updateServiceWorker: async () => {},
  }
}
