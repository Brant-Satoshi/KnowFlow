import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const apiDir = fileURLToPath(new URL('../services/api/', import.meta.url));
const python = join(
  apiDir,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);

if (!existsSync(python)) {
  console.error('Python virtual environment not found. From the repository root, run:');
  console.error('  python3 -m venv services/api/.venv');
  const pythonCommand = process.platform === 'win32'
    ? 'services/api/.venv/Scripts/python.exe'
    : 'services/api/.venv/bin/python';
  console.error(`  ${pythonCommand} -m pip install -r services/api/requirements.txt`);
  process.exit(1);
}

// Keep explicitly exported variables; load local defaults without shell evaluation.
config({
  path: fileURLToPath(new URL('../.env.local', import.meta.url)),
  quiet: true,
});

const server = spawn(python, [
  '-m', 'uvicorn', 'main:app',
  '--host', '127.0.0.1',
  '--port', '8000',
  '--reload',
  ...process.argv.slice(2),
], { cwd: apiDir, stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.kill(signal));
}

server.once('error', (error) => {
  console.error(`Failed to start the Python API: ${error.message}`);
  process.exitCode = 1;
});

server.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
});
