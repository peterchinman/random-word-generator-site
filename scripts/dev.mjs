import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// One command starts Astro and the PHP API. An explicit WORD_API_URL lets a
// developer reuse an existing PHP server instead of starting another one.
const root = fileURLToPath(new URL('../', import.meta.url));
const apiPort = process.env.PHP_PORT || '8001';
const apiUrl = process.env.WORD_API_URL || `http://127.0.0.1:${apiPort}`;
const children = new Set();
let stopping = false;

function stop(code = 0) {
   if (stopping) return;
   stopping = true;
   process.exitCode = code;
   for (const child of children) child.kill('SIGTERM');
   const timeout = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
   }, 3000);
   timeout.unref();
}

function start(command, args, env = process.env) {
   const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
   children.add(child);
   child.on('error', error => { console.error(error.message); stop(1); });
   child.on('exit', code => {
      children.delete(child);
      if (!stopping) stop(code ?? 1);
   });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
if (!process.env.WORD_API_URL) start('php', ['-S', `127.0.0.1:${apiPort}`, '-t', 'public']);
// The wrapper owns the server lifetime, so keep Astro in the foreground even
// when its CLI detects an agent and would otherwise launch a detached server.
start(process.execPath, [fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url)), 'dev', '--ignore-lock', ...process.argv.slice(2)], {
   ...process.env, WORD_API_URL: apiUrl,
});
