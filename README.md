# TeacherTools Overlay

An always-on-top desktop utility app for teachers. The current MVP is a small glowing overlay dot that opens a temporary popout containing fast classroom tools, then closes when you click anywhere outside it.

## What is in the MVP

- Transparent, frameless overlay dot that stays above other windows
- Draggable overlay dot with saved position between launches
- Compact anchored popout window that opens from the dot position, stays small, and dismisses on blur or `Escape`
- Transition timer with presets and pause/resume
- Cold-call picker with no-repeat cycle behavior
- Group maker that shuffles saved class lists into balanced teams
- Local sticky notes for quick reminders
- Tray menu for opening the popout, recentering the dot, and quitting

## Why this stack

- `Electron` gives reliable transparent always-on-top windows on both macOS and Windows
- `React + Vite` keeps the mini-tool UI easy to extend
- All current tool data is stored locally in the app's per-user data directory, so the app works offline and keeps state across restarts

## Run locally

```bash
npm install
npm run dev
```

## Build for desktop

```bash
npm run dist
```

That produces desktop installers for the current platform through `electron-builder`. To ship both macOS and Windows builds, run packaging on each respective operating system.

## Build a Windows x64 package for USB

From this repo, use one of these commands:

```bash
npm run dist:win
```

That builds the configured Windows x64 targets in `package.json`, which are:

- `nsis` for a normal Windows installer
- `portable` for a single portable `.exe` you can copy to a USB drive

If you only want one format, use:

```bash
npm run dist:win:dir
npm run dist:win:portable
npm run dist:win:installer
```

The output files will be written to `dist/`.

- `dist:win:portable` aims to create a single portable `.exe`
- `dist:win:installer` creates a normal Windows installer
- `dist:win:dir` creates `dist/win-unpacked`, which is the raw runnable app folder

If the portable build hangs on macOS, use `npm run dist:win:dir` instead, then copy the entire `dist/win-unpacked` folder to the USB drive or zip that whole folder first. On the Windows x64 machine, open the folder and run `TeacherTools Overlay.exe`. Do not copy only the `.exe`; it needs the rest of the files beside it.

If you run `npm run dist` on macOS, it will build the macOS package, not the Windows one. `electron-builder` supports Windows packaging from macOS and Linux, but if you hit cross-build issues, packaging on a Windows machine is the most reliable fallback.

## Project shape

- `electron/main.ts` handles the overlay window, popout window, and tray
- `electron/preload.ts` exposes a small safe bridge to the renderer
- `src/App.tsx` contains the overlay UI plus the first mini-tools
- `src/styles.css` defines the visual system and motion

## Good next steps

- Add a clearer drag affordance or edge snap behavior for the overlay dot
- Add more teacher modules like a bell-ringer bank and rubric snippets
- Add login-free export and import for rosters and notes
- Add per-tool keyboard shortcuts
