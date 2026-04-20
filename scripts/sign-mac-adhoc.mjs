import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function signMacAppAdHoc(appPath) {
  try {
    await execFileAsync('xattr', ['-cr', appPath]);
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

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await signMacAppAdHoc(appPath);
}

const entryPath = fileURLToPath(import.meta.url);

if (process.argv[1] === entryPath) {
  const appPath = process.argv[2];

  if (!appPath) {
    throw new Error('Expected a macOS .app path as the first argument.');
  }

  await signMacAppAdHoc(path.resolve(appPath));
}
