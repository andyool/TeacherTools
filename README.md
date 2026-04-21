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

Installed app builds now include an `Update app` action in the top dashboard bar. It checks the
latest GitHub release, downloads the update assets, then changes to `Restart to install` once the
update is ready.

### macOS self-signed updates

macOS in-app updates require every release to be signed with the same stable identity. A paid Apple
Developer ID is the smooth public option, but TeacherTools can also use one self-signed certificate
for trusted users.

Create the certificate once:

```bash
npm run mac:self-signed:create -- --password "choose-a-long-private-password"
```

Add these GitHub Actions secrets from the script output:

- `TEACHERTOOLS_MAC_SELF_SIGN_IDENTITY`
- `TEACHERTOOLS_MAC_SELF_SIGN_CERT_PASSWORD`
- `TEACHERTOOLS_MAC_SELF_SIGN_CERT_BASE64`

Do not regenerate this certificate after users install a self-signed build. Future updates must be
signed by the same `.p12`, or ShipIt will reject them during `Restart to install`.

The release workflow publishes `TeacherTools-self-signed-code-signing-cert.cer` next to the DMG.
Trusted macOS users should install that certificate once, then manually install one self-signed DMG.
After that, future self-signed releases can update in app.

For each Mac:

1. Download `TeacherTools-self-signed-code-signing-cert.cer` from the GitHub release.
2. Open Keychain Access, choose the `System` keychain, and import the certificate.
3. Open the certificate in Keychain Access, expand `Trust`, set `Code Signing` to `Always Trust`,
   close the window, and enter the admin password.
4. Download the DMG, drag `TeacherTools Overlay.app` into `/Applications`, and replace any old copy.
5. Control-click `/Applications/TeacherTools Overlay.app`, choose `Open`, then choose `Open` again.
6. If macOS still blocks the first launch, run:

```bash
sudo xattr -dr com.apple.quarantine "/Applications/TeacherTools Overlay.app"
open "/Applications/TeacherTools Overlay.app"
```

Users already on an ad-hoc signed build must do this manual install once before in-app updates can
work.
