import { spawnSync } from 'node:child_process';

const releaseType = process.argv[2];
const allowedReleaseTypes = new Set(['patch', 'minor', 'major']);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!allowedReleaseTypes.has(releaseType)) {
  console.error('[release:auto] Expected one of: patch, minor, major.');
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  return result.stdout ?? '';
}

const workingTreeStatus = capture('git', ['status', '--porcelain']).trim();

if (workingTreeStatus) {
  console.log('[release:auto] Staging and committing current changes.');
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', 'Prepare release']);
} else {
  console.log('[release:auto] No uncommitted changes found. Skipping prep commit.');
}

console.log(`[release:auto] Creating ${releaseType} version bump and pushing to GitHub.`);
run(npmCommand, ['version', releaseType]);
run('git', ['push', 'origin', 'HEAD', '--follow-tags']);
