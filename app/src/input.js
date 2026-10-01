// OS 级键鼠输入：spawn 一个极小的原生 input.exe（user32 的 SendInput/mouse_event）。
// 坐标约定：模型看到的是 1280x720 的屏幕截图，给的坐标也在这个空间里；
// 这里归一化成 0..1 再交给 exe，避免 DPI/分辨率差异。
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const userinput = require('./userinput');

const W = 1280, H = 720;   // 屏幕流抓帧尺寸，模型坐标空间

function exePath() {
  const dev = path.join(__dirname, '..', 'vendor', 'input', 'input.exe');
  const packed = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'vendor', 'input', 'input.exe');
  if (fs.existsSync(dev)) return dev;
  if (fs.existsSync(packed)) return packed;
  return dev;
}

function norm(x, y) {
  const nx = Math.max(0, Math.min(W, Number(x) || 0)) / W;
  const ny = Math.max(0, Math.min(H, Number(y) || 0)) / H;
  return [nx.toFixed(4), ny.toFixed(4)];
}

function run(action, args) {
  const exe = exePath();
  if (!fs.existsSync(exe)) throw new Error('缺少 input.exe');
  const r = spawnSync(exe, [action].concat(args.map(String)), { encoding: 'utf8', timeout: 8000, windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('input 失败：' + String(r.stderr || '').trim());
  return true;
}

/* 落点要在**执行之前**登记（src/userinput.js 的让位检测用）：
 *   如果放在执行之后，轮询（默认 40ms）完全可能插在 run() 和 mark() 中间，
 *   于是她自己刚移过去的位移被当成"主人在用鼠标"→ 她一动就把自己暂停（实测踩到过）。
 *   登记失败绝不能影响真正要做的操作，所以整块 try 包住。
 *   注：动作失败时这条预期落点会失效，但检测里有 3 秒窗口 + 40px 半径，不会长期误判。 */
function mark(x, y) { try { userinput.notePetMoveModel(x, y); } catch {} }

function click(x, y) { const p = norm(x, y); mark(x, y); return run('click', p); }
function rclick(x, y) { const p = norm(x, y); mark(x, y); return run('rclick', p); }
function dclick(x, y) { const p = norm(x, y); mark(x, y); return run('dclick', p); }
function move(x, y) { const p = norm(x, y); mark(x, y); return run('move', p); }
function drag(x1, y1, x2, y2) { const p = norm(x1, y1).concat(norm(x2, y2)); mark(x2, y2); return run('drag', p); }
function scroll(x, y, delta) { const p = norm(x, y); mark(x, y); return run('scroll', p.concat([String(delta == null ? 120 : delta)])); }
function type(text) { return run('type', [String(text)]); }
function key(name) { return run('key', [String(name)]); }

module.exports = { click, rclick, dclick, move, drag, scroll, type, key, W, H, exePath, norm };
