# TeacherTools
Widgets and tools for teachers, accessible quickly via glowing dot overlay

## Releases

GitHub Actions now builds and publishes release assets when you push a version tag that starts with `v`.

Typical one-command release flow after you have committed your changes:

```bash
npm run release:patch
```

You can also use `npm run release:minor` or `npm run release:major`.

That command will:

1. bump the version in `package.json`
2. create a matching git tag such as `v0.1.1`
3. push the commit and tag to GitHub
4. trigger the release workflow that builds macOS and Windows packages and publishes a GitHub release

The GitHub Pages download links in `docs/index.html` point to `releases/latest/download/...`, so they stay stable across releases.
