import { spawn } from 'node:child_process';
import path from 'node:path';

const electronBinary = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

const env = {
  ...process.env
};

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ['.'], {
  stdio: 'inherit',
  env
});

child.once('error', (error) => {
  console.error('[start-electron] Failed to launch Electron.');
  console.error(error);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
  }

  process.exit(signal ? 1 : 0);
});

process.on('SIGINT', () => {
  if (!child.killed) {
    child.kill('SIGINT');
  }
});

process.on('SIGTERM', () => {
  if (!child.killed) {
    child.kill('SIGTERM');
  }
});
