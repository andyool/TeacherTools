# Project Guidelines

## Code Style
- TypeScript: Strict mode enabled, ESNext modules, React JSX transform. See `tsconfig.json` for renderer config and `tsconfig.node.json` for main process.
- Naming: Kebab-case for files (e.g., `dev-electron.mjs`), PascalCase for components and types.
- Styling: CSS variables and classes for visual effects (glows, transparency). No preprocessors.

## Architecture
- Electron app with React renderer, Vite bundler, TypeScript throughout.
- Multi-window setup: Overlay (always-on-top dot), Popover (anchored tools), Builder, Widget Picker.
- IPC via preload script for secure communication between main (Node.js) and renderer (browser) processes.
- Data stored locally in browser storage; no backend.
- Routing: Hash-based for UI modes.
See `electron/main.ts` for window management and `src/App.tsx` for UI logic.

## Build and Test
- Install: `npm install`
- Dev: `npm run dev` (concurrent main, renderer, electron)
- Build: `npm run build`
- Distribute: `npm run dist` (electron-builder)
- Preview: `npm run preview`
- Start: `npm run start`
No automated tests configured; manual testing via dev runs.

## Conventions
- File structure: `electron/` for main process, `src/` for renderer, `scripts/` for tooling.
- Preload bridge: Use `electronAPI` on `window` for IPC; context isolation enabled.
- Environment: Vite vars for dev server config.
- No linting or formatting tools; style is manual.
Potential pitfalls: Sync issues in dev setup, window positioning on multi-monitors, transparent window glitches.
See README.md for full overview and features.