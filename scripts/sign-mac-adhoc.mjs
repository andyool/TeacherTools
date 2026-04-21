import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Arch } from 'builder-util';

const execFileAsync = promisify(execFile);

function getSelfSignedIdentity() {
  return (
    process.env.TEACHERTOOLS_MAC_SELF_SIGN_IDENTITY ||
    process.env.MAC_SELF_SIGN_IDENTITY ||
    ''
  ).trim();
}

function isSelfSignedSigningRequired() {
  return process.env.TEACHERTOOLS_MAC_SELF_SIGN_REQUIRED === 'true';
}

function hasExplicitMacSigningConfig() {
  return Boolean(
    process.env.CSC_LINK ||
      process.env.CSC_NAME ||
      process.env.MAC_CSC_LINK ||
      process.env.MAC_CSC_NAME
  );
}

export async function clearMacAppExtendedAttributes(appPath) {
  await execFileAsync('xattr', ['-cr', appPath]);
}

export async function signMacAppAdHoc(appPath) {
  try {
    await clearMacAppExtendedAttributes(appPath);
    await execFileAsync('codesign', ['--force', '--deep', '--sign', '-', appPath]);
    await execFileAsync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('resource fork, Finder information, or similar detritus not allowed')
    ) {
      throw new Error(
        `Ad-hoc signing failed for ${appPath} because macOS added Finder/iCloud extended attributes to the app bundle. ` +
          'Build from a non-iCloud-synced path such as /tmp or ~/Code, or use the GitHub Actions release workflow.'
      );
    }

    throw error;
  }
}

export async function signMacAppWithIdentity(appPath, identity) {
  await clearMacAppExtendedAttributes(appPath);
  await execFileAsync('codesign', [
    '--force',
    '--deep',
    '--timestamp=none',
    '--sign',
    identity,
    appPath
  ]);
  await execFileAsync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  if (context.arch !== Arch.universal) {
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  const selfSignedIdentity = getSelfSignedIdentity();
  if (selfSignedIdentity) {
    await signMacAppWithIdentity(appPath, selfSignedIdentity);
    return;
  }

  if (isSelfSignedSigningRequired()) {
    throw new Error(
      'TEACHERTOOLS_MAC_SELF_SIGN_IDENTITY must be set when TEACHERTOOLS_MAC_SELF_SIGN_REQUIRED=true.'
    );
  }

  if (hasExplicitMacSigningConfig()) {
    await clearMacAppExtendedAttributes(appPath);
    return;
  }

  await signMacAppAdHoc(appPath);
}

const entryPath = fileURLToPath(import.meta.url);

if (process.argv[1] === entryPath) {
  const appPath = process.argv[2];

  if (!appPath) {
    throw new Error('Expected a macOS .app path as the first argument.');
  }

  const identity = getSelfSignedIdentity();
  if (identity) {
    await signMacAppWithIdentity(path.resolve(appPath), identity);
  } else {
    await signMacAppAdHoc(path.resolve(appPath));
  }
}
