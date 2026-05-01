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
    const error = new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
    error.exitCode = result.status;
    throw error;
  }
}

function captureResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function capture(command, args) {
  const result = captureResult(command, args);

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  return result.stdout ?? '';
}

function exitWithMessage(message, exitCode = 1) {
  console.error(`[release:auto] ${message}`);
  process.exit(exitCode);
}

function refExists(ref) {
  const result = captureResult('git', ['rev-parse', '--verify', '--quiet', ref], {
    stdio: 'ignore'
  });
  return result.status === 0;
}

function getAheadBehind(baseRef) {
  const ahead = Number(capture('git', ['rev-list', '--count', `${baseRef}..HEAD`]).trim() || '0');
  const behind = Number(capture('git', ['rev-list', '--count', `HEAD..${baseRef}`]).trim() || '0');
  return { ahead, behind };
}

const currentBranch = capture('git', ['branch', '--show-current']).trim();

if (!currentBranch) {
  exitWithMessage('Releases must be run from a named branch.');
}

const remoteTrackingBranch = `origin/${currentBranch}`;

if (refExists(remoteTrackingBranch)) {
  const { ahead, behind } = getAheadBehind(remoteTrackingBranch);

  if (ahead > 0) {
    exitWithMessage(
      `Local branch is ahead of ${remoteTrackingBranch} by ${ahead} commit(s). Push the unpublished commits before running release:auto again.\n[release:auto] Retry with: git push origin HEAD --follow-tags`
    );
  }

  if (behind > 0) {
    exitWithMessage(
      `Local branch is behind ${remoteTrackingBranch} by ${behind} commit(s). Pull the latest changes before creating a release.`
    );
  }
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

try {
  run('git', ['push', 'origin', 'HEAD', '--follow-tags']);
} catch (error) {
  console.error(
    '[release:auto] The version bump succeeded locally, but the push failed. Do not rerun release:auto yet.'
  );
  console.error('[release:auto] Retry with: git push origin HEAD --follow-tags');

  if (error && typeof error === 'object' && 'exitCode' in error && Number.isInteger(error.exitCode)) {
    process.exit(error.exitCode);
  }

  throw error;
}
