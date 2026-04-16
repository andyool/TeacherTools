import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { access } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const devHost = process.env.VITE_DEV_HOST ?? '127.0.0.1';
const parsedDevPort = Number.parseInt(process.env.VITE_DEV_PORT ?? '5180', 10);
const devPort = Number.isFinite(parsedDevPort) ? parsedDevPort : 5180;
const rendererUrl = `http://${devHost}:${devPort}`;
const rendererMode = process.env.ELECTRON_RENDERER_MODE === 'server' ? 'server' : 'file';
const electronBundleFiles = ['dist-electron/main.js', 'dist-electron/preload.cjs'];
const rendererBuildFiles = ['dist/index.html', 'dist/assets'];
const buildOutputPollMs = 120;
const buildOutputQuietMs = 500;
const requiredFiles =
  rendererMode === 'server'
    ? electronBundleFiles
    : [...electronBundleFiles, ...rendererBuildFiles];

function createElectronEnv() {
  const nextEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: ''
  };

  if (rendererMode === 'server') {
    nextEnv.VITE_DEV_SERVER_URL = rendererUrl;
  } else {
    delete nextEnv.VITE_DEV_SERVER_URL;
  }

  return nextEnv;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function tcpAvailable(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });

    const finish = (available) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(available);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

async function waitForDevDependencies() {
  if (rendererMode === 'server') {
    process.stdout.write(`[dev-electron] Waiting for ${rendererUrl} and Electron bundles...\n`);
  } else {
    process.stdout.write('[dev-electron] Waiting for local renderer build and Electron bundles...\n');
  }

  while (true) {
    const checks =
      rendererMode === 'server'
        ? [tcpAvailable(devHost, devPort), ...requiredFiles.map((filePath) => fileExists(filePath))]
        : requiredFiles.map((filePath) => fileExists(filePath));

    const results = await Promise.all(checks);

    if (results.every(Boolean)) {
      return;
    }

    await delay(250);
  }
}

function getPathFingerprint(targetPath) {
  try {
    const stats = fs.statSync(targetPath);

    if (stats.isDirectory()) {
      const entries = fs
        .readdirSync(targetPath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));

      return `dir:${targetPath}:${entries
        .map((entry) => getPathFingerprint(path.join(targetPath, entry.name)))
        .join('|')}`;
    }

    return `file:${targetPath}:${stats.size}:${Math.floor(stats.mtimeMs)}`;
  } catch {
    return `missing:${targetPath}`;
  }
}

function getCombinedFingerprint(paths) {
  return paths.map((targetPath) => getPathFingerprint(targetPath)).join('||');
}

async function waitForStableBuildOutputs(paths) {
  let lastFingerprint = getCombinedFingerprint(paths);
  let stableSince = Date.now();

  while (true) {
    await delay(buildOutputPollMs);
    const nextFingerprint = getCombinedFingerprint(paths);

    if (nextFingerprint !== lastFingerprint) {
      lastFingerprint = nextFingerprint;
      stableSince = Date.now();
      continue;
    }

    if (Date.now() - stableSince >= buildOutputQuietMs) {
      return nextFingerprint;
    }
  }
}

async function main() {
  const electronBinary = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron'
  );

  let activeChild = null;
  let isShuttingDown = false;
  let restartPending = false;
  let relaunchInProgress = false;
  let restartTimer = null;
  let pollTimer = null;
  let pollInProgress = false;
  const watchTargets = requiredFiles;
  let lastFingerprint = '';

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const getExitCode = (code, signal) => {
    if (typeof code === 'number') {
      return code;
    }

    return signal ? 1 : 0;
  };

  const launchElectron = async () => {
    relaunchInProgress = true;
    await waitForDevDependencies();
    lastFingerprint = await waitForStableBuildOutputs(watchTargets);

    process.stdout.write(
      rendererMode === 'server'
        ? `[dev-electron] Launching Electron against ${rendererUrl}\n`
        : '[dev-electron] Launching Electron against local files\n'
    );

    const child = spawn(electronBinary, ['.'], {
      stdio: 'inherit',
      env: createElectronEnv()
    });

    activeChild = child;
    relaunchInProgress = false;

    child.once('error', (error) => {
      console.error('[dev-electron] Failed to launch Electron.');
      console.error(error);
      isShuttingDown = true;
      stopPolling();
      process.exit(1);
    });

    child.once('exit', async (code, signal) => {
      const exitCode = getExitCode(code, signal);

      if (activeChild === child) {
        activeChild = null;
      }

      if (isShuttingDown) {
        stopPolling();
        process.exit(exitCode);
        return;
      }

      if (restartPending) {
        restartPending = false;

        try {
          await launchElectron();
        } catch (error) {
          console.error('[dev-electron] Failed to relaunch Electron.');
          console.error(error);
          stopPolling();
          process.exit(1);
        }

        return;
      }

      stopPolling();
      process.exit(exitCode);
    });
  };

  const scheduleRestart = (reason) => {
    if (isShuttingDown) {
      return;
    }

    if (restartTimer) {
      clearTimeout(restartTimer);
    }

    restartTimer = setTimeout(() => {
      restartTimer = null;

      if (relaunchInProgress || restartPending) {
        return;
      }

      restartPending = true;
      process.stdout.write(`[dev-electron] Change detected (${reason}). Restarting Electron...\n`);

      if (activeChild && !activeChild.killed) {
        activeChild.kill('SIGTERM');
      }
    }, 220);
  };

  const forwardSignal = (signal) => {
    isShuttingDown = true;

    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }

    stopPolling();

    if (activeChild && !activeChild.killed) {
      activeChild.kill(signal);
    }
  };

  await launchElectron();
  pollTimer = setInterval(() => {
    if (pollInProgress || isShuttingDown || relaunchInProgress || restartPending) {
      return;
    }

    pollInProgress = true;

    try {
      const nextFingerprint = getCombinedFingerprint(watchTargets);

      if (nextFingerprint !== lastFingerprint) {
        lastFingerprint = nextFingerprint;
        scheduleRestart('build outputs updated');
      }
    } finally {
      pollInProgress = false;
    }
  }, 350);

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
}

main().catch((error) => {
  console.error('[dev-electron] Failed to launch Electron.');
  console.error(error);
  process.exit(1);
});
