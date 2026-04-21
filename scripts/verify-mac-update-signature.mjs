import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const appPath = path.resolve(process.argv[2] ?? 'release/mac-universal/TeacherTools Overlay.app');

async function runCodesign(args) {
  try {
    const result = await execFileAsync('codesign', args);
    return `${result.stdout}${result.stderr}`;
  } catch (error) {
    const output =
      error && typeof error === 'object' && 'stdout' in error && 'stderr' in error
        ? `${error.stdout ?? ''}${error.stderr ?? ''}`
        : '';
    const message = error instanceof Error ? error.message : 'codesign failed';
    throw new Error(output.trim() || message);
  }
}

const signatureDetails = await runCodesign(['-dv', '--verbose=4', appPath]);

if (signatureDetails.includes('Signature=adhoc')) {
  throw new Error(
    `${appPath} is ad-hoc signed. macOS auto-updates need a stable certificate signature; configure TEACHERTOOLS_MAC_SELF_SIGN_IDENTITY for release builds.`
  );
}

const designatedRequirement = await runCodesign(['-dr', '-', appPath]);

if (/cdhash H"/.test(designatedRequirement)) {
  throw new Error(
    `${appPath} has a cdhash-only designated requirement. ShipIt will reject the next version unless releases are signed with the same certificate identity.`
  );
}

await runCodesign(['--verify', '--deep', '--strict', '--verbose=2', appPath]);

console.log(`Verified stable macOS update signature for ${appPath}.`);
