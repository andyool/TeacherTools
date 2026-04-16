import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isServerMode = process.argv.includes('--server');
const skipElectron = process.env.TEACHERTOOLS_SKIP_ELECTRON === '1';
const binExtension = process.platform === 'win32' ? '.cmd' : '';
const repoRoot = process.cwd();
const buildOutputDirs = ['dist', 'dist-electron'];

const colors = {
  electron: '\x1b[35m',
  main: '\x1b[33m',
  renderer: '\x1b[36m',
  reset: '\x1b[0m'
};

const tasks = [
  {
    name: 'main',
    color: colors.main,
    command: path.join(repoRoot, 'node_modules', '.bin', `tsc${binExtension}`),
    args: ['-p', 'tsconfig.node.json', '--watch', '--preserveWatchOutput']
  },
  {
    name: 'renderer',
    color: colors.renderer,
    command: path.join(repoRoot, 'node_modules', '.bin', `vite${binExtension}`),
    args: isServerMode ? ['--clearScreen', 'false'] : ['build', '--watch', '--clearScreen', 'false']
  },
  ...(skipElectron
    ? []
    : [
        {
          name: 'electron',
          color: colors.electron,
          command: process.execPath,
          args: ['./scripts/dev-electron.mjs'],
          env: {
            ...(isServerMode ? { ELECTRON_RENDERER_MODE: 'server' } : {})
          }
        }
      ])
];

const children = new Map();
let shuttingDown = false;
let exitCode = 0;

function prefixLine(name, color, line) {
  return `${color}[${name}]${colors.reset} ${line}`;
}

function attachPrefixedOutput(child, task, streamName, stream) {
  let buffer = '';
  const lineBreakPattern = /\r\n|\n|\r/;

  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = [];
    let remaining = buffer;

    while (true) {
      const match = lineBreakPattern.exec(remaining);
      if (!match) {
        break;
      }

      const line = remaining.slice(0, match.index);
      lines.push(line);
      remaining = remaining.slice(match.index + match[0].length);
    }

    buffer = remaining;

    for (const line of lines) {
      const target = streamName === 'stderr' ? process.stderr : process.stdout;
      target.write(`${prefixLine(task.name, task.color, line)}\n`);
    }
  });

  stream.on('end', () => {
    if (!buffer) {
      return;
    }

    const target = streamName === 'stderr' ? process.stderr : process.stdout;
    target.write(`${prefixLine(task.name, task.color, buffer)}\n`);
    buffer = '';
  });
}

function stopChildren(signal = 'SIGTERM') {
  for (const child of children.values()) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

function startTask(task) {
  const child = spawn(task.command, task.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...task.env
    },
    stdio: ['inherit', 'pipe', 'pipe']
  });

  children.set(task.name, child);
  attachPrefixedOutput(child, task, 'stdout', child.stdout);
  attachPrefixedOutput(child, task, 'stderr', child.stderr);

  child.once('error', (error) => {
    process.stderr.write(
      `${prefixLine(task.name, task.color, 'Failed to start process.')}\n`
    );
    process.stderr.write(`${prefixLine(task.name, task.color, String(error))}\n`);
    exitCode = 1;
    shuttingDown = true;
    stopChildren();
  });

  child.once('exit', (code, signal) => {
    children.delete(task.name);

    if (shuttingDown) {
      if (children.size === 0) {
        process.exit(exitCode || (typeof code === 'number' ? code : signal ? 1 : 0));
      }
      return;
    }

    const normalizedExitCode = typeof code === 'number' ? code : signal ? 1 : 0;
    exitCode = normalizedExitCode;

    const reason =
      typeof code === 'number'
        ? `Process exited with code ${code}.`
        : `Process exited with signal ${signal}.`;
    process.stderr.write(`${prefixLine(task.name, task.color, reason)}\n`);

    shuttingDown = true;
    stopChildren();
  });
}

function handleShutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  exitCode = 0;
  stopChildren(signal);

  if (children.size === 0) {
    process.exit(0);
  }
}

for (const relativeDir of buildOutputDirs) {
  fs.rmSync(path.join(repoRoot, relativeDir), { force: true, recursive: true });
}

for (const task of tasks) {
  startTask(task);
}

if (skipElectron) {
  process.stdout.write(
    `${prefixLine('dev', colors.electron, 'Skipping Electron because TEACHERTOOLS_SKIP_ELECTRON=1.')}\n`
  );
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
