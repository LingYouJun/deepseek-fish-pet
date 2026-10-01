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

/* 键名白名单（和 vendor/input/Input.cs 的 Vk() 保持一致）。
 * 为什么 Node 侧也要拦一道：C# 那边抛的是 "unknown key: cmd" 这种，模型拿到不知道怎么改；
 * 这里给它"可用哪些键"的明确提示，它下一轮就能自己改正。
 * 更重要的是**在 spawn 之前就拒绝** —— 坏键名根本不会碰到键盘。
 * （键盘卡死那个事故就是坏键名引起的，见 Input.cs 里 key 分支的注释。） */
const KEY_NAMES = ['enter', 'esc', 'escape', 'tab', 'space', 'backspace', 'delete', 'del', 'insert', 'ins',
  'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'ctrl', 'control', 'alt', 'shift', 'win'];
function validateKey(name) {
  const raw = String(name == null ? '' : name).toLowerCase();
  const parts = raw.split('+').map((x) => x.trim());
  if (!parts.length || parts.some((p) => !p)) throw new Error('按键名写错了（是不是多了个 + ？）：' + raw);
  const okOne = (n) => KEY_NAMES.includes(n) || n.length === 1 || /^f([1-9]|1[0-9]|2[0-4])$/.test(n);
  for (const p of parts) {
    if (!okOne(p)) {
      throw new Error('不认识的按键名「' + p + '」。可用：enter / esc / tab / space / backspace / delete / '
        + 'up,down,left,right / home / end / pageup / pagedown / f1~f24 / 单个字母或数字 / '
        + '组合键用 ctrl+alt+shift+win 加号连接（例如 ctrl+c）');
    }
  }
  return raw;
}
function key(name) { return run('key', [validateKey(name)]); }

/* 把所有可能卡住的修饰键和鼠标键松开。
 * 这是"键盘被搞坏"的兜底：应用启动时清一次上次异常退出留下的卡键、
 * 游戏助手收手时、退出之前各调一次。
 * 实测旧版 input.exe 只要键名写错就会把 Ctrl 卡住（用户表现：输入不了东西、
 * 键盘像错位了，只能重启）—— 现在启动时就能自动治好。 */
function releaseAll() {
  try { return run('releaseall', []); } catch { return false; }
}

module.exports = { click, rclick, dclick, move, drag, scroll, type, key, W, H, exePath, norm, releaseAll, validateKey, KEY_NAMES };
