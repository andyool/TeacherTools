# TeacherTools
Widgets and tools for teachers, accessible quickly via glowing dot overlay

## Releases

GitHub Actions now builds and publishes release assets when you push a version tag that starts with `v`.

Typical one-command release flow after you have committed your changes:

```bash
npm run release:patch
```

If you want the repo to auto-stage and auto-commit everything first, use:

```bash
npm run release:auto:patch
```

You can also use `npm run release:auto:minor` or `npm run release:auto:major`.
The auto-release commands create a prep commit with the message `Prepare release` before the version bump.

If you prefer to commit manually first, you can still use `npm run release:patch`,
`npm run release:minor`, or `npm run release:major`.

That command will:

1. bump the version in `package.json`
2. create a matching git tag such as `v0.1.1`
3. push the commit and tag to GitHub
4. trigger the release workflow that builds macOS and Windows packages and publishes a GitHub release

The GitHub Pages download links in `docs/index.html` point to `releases/latest/download/...`, so they stay stable across releases.

Installed app builds now include an `Update app` action in the top dashboard bar. On Windows it
checks the latest GitHub release, downloads the installer assets, then changes to
`Restart to install` once the update is ready.

On macOS, the app checks GitHub Releases and then opens the latest DMG download instead of trying
to auto-install in place. Full in-app auto-update on macOS requires signed releases.
