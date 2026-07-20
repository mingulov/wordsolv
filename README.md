# wordsolv — Word-Grid Solver Assistant

A solver assistant for Wordle, Quordle and other word-grid games. You play the real game elsewhere, enter your guesses and color feedback into the app, and it suggests the best next guesses. Supports English and Russian, 1–16 boards, word lengths 4–8.

**Primary target:** Russian Quordle (5-letter words, 4 boards). Measured **100.00% win rate over 1000 seeded games** with an average of **7.228 guesses per game** in deep mode — comfortably above the ≥99% spec target, on the full-corpus answer pool (2,744 words, up from 999 before the 2026-07-19 dictionary rebuild). See [BENCHMARKS.md](packages/solver-core/BENCHMARKS.md) for details.

## Features

- **Multi-language:** English and Russian, with keyboard input normalization (Russian ё → е)
- **Multi-board:** 1–16 boards, any word length 4–8
- **Solver modes:** Lite (entropy-based) and deep (2-ply lookahead with pattern table); fast inference even on mid-range phones
- **PWA:** Installable; app shell plus the ru-5/en-5 dictionaries are precached for offline use on first load, other language/length dictionaries are cached by the service worker after their first online use
- **Responsive UI:** Light/dark theme; English and Russian UI localization

## Project Structure

This is an npm workspace monorepo:

```
wordsolv/
├── packages/solver-core/    # Pure TypeScript library: state model, word filtering,
│   ├── src/                 # solver algorithms, simulation harness. No DOM/React.
│   ├── bin/                 # CLI tools: solve.ts (solver), simulate.ts (benchmark)
│   ├── dict/                # Vendored word lists + build pipeline
│   └── BENCHMARKS.md        # Performance measurements
└── apps/web/                # React + Vite + TypeScript PWA
    ├── src/                 # UI components, Web Worker integration
    └── dist/                # Built static assets (generated)
```

## Quick Start

### Installation & Development

```bash
npm install
npm run dev       # Start web dev server (http://localhost:5173)
```

### Solver CLI

```bash
# Show solver suggestions for a game file
npm run solve -- game.txt

# Benchmark the solver (RU Quordle 5×4, deep mode, 100 games)
npm run bench -- --lang ru --len 5 --boards 4 --games 100 --seed 1 --mode deep

# Other configurations
npm run bench -- --lang en --len 5 --boards 1 --games 1000 --mode lite
```

**Game file format** (`game.txt`):
```
lang en
len 5
boards 1

guess1_word feedback_pattern
guess2_word feedback_pattern
```
Feedback: `+` = green (correct position), `*` = yellow (wrong position), `-` = gray (not in word). (Also accepted: `g`/`G`/`2`, `y`/`Y`/`1`, `x`/`X`/`0`.)

Example:
```
lang en
len 5
boards 1

crane --+-+
slate +-+-+
```

### Testing & Quality

```bash
npm test                              # Run all workspace tests (includes 10-min benchmark gates)
npm run typecheck --workspaces        # TypeScript check
cd packages/solver-core && npx vitest run  # Solver-core tests (fast suite)
npm test -w @wordsolv/web           # Web app tests
npm run build -w @wordsolv/web      # Build web app (for production)
```

## Deploying to GitHub Pages

The included GitHub Actions workflow automates all build, test, and deploy steps. To deploy your own instance:

### 1. Create a GitHub Repository

```bash
# Create a new GitHub repository on github.com
# (choose either a user site (*.github.io) or organization/project site)

# Add the remote to your local repo
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

### 2. Enable GitHub Pages

In your repository's **Settings → Pages**:
- **Source:** Select "GitHub Actions"

That's it — the workflow will deploy automatically on every push to `main`.

### 3. URL Base Path

The app automatically derives the base path from your repository name:
- **User/org site** (`*.github.io`): serves at `/` (e.g., `https://yourname.github.io/`)
- **Project site**: serves at `/<repo-name>/` (e.g., `https://github.com/yourname/wordsolv` → `https://yourname.github.io/wordsolv/`)

No configuration needed — the build system handles this from the `GITHUB_REPOSITORY` environment variable.

## Documentation

- [Wordle Solver Design Spec](docs/superpowers/specs/2026-07-18-wordle-solver-design.md) — architecture, data model, dictionaries, scope
- [Solver CLI Design Spec](docs/superpowers/specs/2026-07-19-solve-cli-design.md) — CLI tool design and usage
- [Web UI Design Spec](docs/superpowers/specs/2026-07-19-web-ui-design.md) — React PWA design, offline support, localization
- [Benchmarks](packages/solver-core/BENCHMARKS.md) — performance measurements and regression gates

## Architecture Highlights

- **Solver core**: Language-agnostic, reusable library; no DOM dependencies. Entropy-based filtering + exact endgame search.
- **Deep mode:** Pre-built pattern table + 2-ply lookahead for improved guess quality; trades startup time for better suggestions.
- **Dictionaries:** Two tiers per language+length (answer candidates + broader guess pool); lazy-loaded, service-worker cached.
- **Web UI:** React + TypeScript, runs solver in a Web Worker to keep the UI responsive. Fully offline (PWA).

## Development Notes

- Monorepo managed with npm workspaces
- TypeScript strict mode across all packages
- Vitest for unit tests and benchmarks
- React + Vite for the web app
- Service Worker (Workbox) for offline support and caching

## License

See individual package READMEs for license information.
