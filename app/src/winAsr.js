const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const emitter = new EventEmitter();
let child = null;
let stopped = true;

function scriptPath() {
  const src = path.join(__dirname, '..', 'scripts', 'wake-listener.ps1');
  const dst = path.join(app.getPath('userData'), 'wake-listener.ps1');
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  } catch {}
  return dst;
}

function powershellPath() {
  const candidates = [
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'powershell.exe'
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return 'powershell.exe';
}

function start(cfg = {}) {
  stop();
  stopped = false;
  const wakeWords = (Array.isArray(cfg.wakeWords) ? cfg.wakeWords : [cfg.wakeWords])
    .filter(Boolean).join('|') || '你好大肥鱼';
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath(),
    '-WakeWords', wakeWords,
    '-Language', cfg.wakeLang || 'zh-CN',
    '-Sensitivity', String(Number(cfg.wakeSensitivity) || 0.55),
    '-InitialMode', cfg.initialMode === 'command' ? 'command' : 'wake'
  ];
  try {
    child = spawn(powershellPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    emitter.emit('error', { message: e.message || String(e) });
    return false;
  }
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += String(d);
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        const msg = JSON.parse(s);
        if (msg.type === 'wake') emitter.emit('wake', msg);
        else if (msg.type === 'command') emitter.emit('command', msg);
        else if (msg.type === 'error') emitter.emit('error', msg);
        else if (msg.type === 'status') emitter.emit('status', msg);
      } catch {}
    }
  });
  let errBuf = '';
  child.stderr.on('data', (d) => { errBuf += String(d); });
  child.on('error', (e) => emitter.emit('error', { message: e.message || String(e) }));
  child.on('exit', (code, signal) => {
    if (!stopped && code !== 0) {
      emitter.emit('error', { message: `语音监听已退出 code=${code} signal=${signal || ''} ${errBuf.slice(0, 200)}` });
    }
    child = null;
  });
  return true;
}

function stop() {
  stopped = true;
  if (child) {
    try { child.kill(); } catch {}
    child = null;
  }
}

module.exports = { start, stop, on: (ev, cb) => emitter.on(ev, cb), off: (ev, cb) => emitter.off(ev, cb) };
