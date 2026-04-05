/**
 * Apaga .next, liberta a porta do dev (p.ex. 3000) e inicia `next dev`.
 * Windows: netstat + taskkill. Unix: lsof quando disponível.
 */
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const root = path.join(__dirname, '..');
const port = process.env.PORT || '3000';

function rmNext() {
  try {
    fs.rmSync(path.join(root, '.next'), { recursive: true, force: true });
  } catch (_) {}
}

function killListenersWin(p) {
  let out;
  try {
    out = execSync('netstat -ano', { encoding: 'utf8' });
  } catch {
    return;
  }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const state = parts[3];
    if (!/^(LISTENING|OUVINTE)$/i.test(state)) continue;
    const local = parts[1];
    const portMatch = local.match(/:(\d+)$/);
    if (!portMatch || String(portMatch[1]) !== String(p)) continue;
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid)) pids.add(pid);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } catch (_) {}
  }
}

function killListenersUnix(p) {
  let out;
  try {
    out = execSync(`lsof -ti tcp:${p}`, { encoding: 'utf8' });
  } catch (_) {
    try {
      execSync(`fuser -k ${p}/tcp`, { stdio: 'ignore' });
    } catch (_) {}
    return;
  }
  const pids = out
    .trim()
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
  for (const pid of new Set(pids)) {
    try {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    } catch (_) {}
  }
}

rmNext();
if (process.platform === 'win32') {
  killListenersWin(port);
} else {
  killListenersUnix(port);
}

console.log('\n[SempreDesk] Após subir, confirme o servidor correto:');
console.log(`  http://localhost:${port}/api/health  → deve devolver JSON { "ok": true, "app": "sempredesk-frontend", ... }`);
console.log('  Se vir 404 ou HTML de outra app, há outro processo na porta ou cache do browser.\n');

const nextCli = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextCli, 'dev', '-p', port], {
  cwd: root,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code == null ? 1 : code);
});
