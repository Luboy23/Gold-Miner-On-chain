import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '../frontend');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode !== undefined && response.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await requestOk(url)) {
      return;
    }

    if (child.exitCode !== null) {
      throw new Error('frontend smoke server exited before becoming healthy');
    }

    await wait(1000);
  }

  throw new Error('frontend smoke server did not become healthy in time');
}

function forwardExit(code, signal) {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
}

async function main() {
  const webServer = spawn(
    npmCommand,
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4174'],
    {
      cwd: frontendDir,
      stdio: 'inherit',
      env: process.env,
    },
  );

  const cleanup = () => {
    if (webServer.exitCode === null) {
      webServer.kill('SIGTERM');
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await waitForServer('http://127.0.0.1:4174', webServer);

    const smoke = spawn(npmCommand, ['run', 'test:e2e:smoke:attached'], {
      cwd: frontendDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_NO_WEBSERVER: '1',
      },
    });

    smoke.on('exit', (code, signal) => {
      cleanup();
      forwardExit(code, signal);
    });
  } catch (error) {
    cleanup();
    console.error(
      error instanceof Error ? error.message : 'frontend smoke runner failed',
    );
    process.exit(1);
  }
}

void main();
