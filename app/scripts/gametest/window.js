/* window.js —— ★假游戏测试屏（Electron 全屏窗 + 自己记录"实际被点到的是谁"= 真值 ✓）★
 *
 * 启动：Start-Process electron.exe -ArgumentList "<repo>\app\scripts\gametest\window.js","--user-data-dir=<临时目录>"
 *   ★自己带 --user-data-dir ✓ → 绝不与她的实例抢单实例锁 ✓ 也绝不碰她的进程 ✓★
 * 记录：每次 mousedown → 追加一行 JSONL 到 C:\deepseek\gametest\clicks.jsonl
 *       （字段：t 时间戳、id 被点按钮的 id、label、kind、x/y 窗口内坐标、sx/sy 屏幕坐标 ✓）
 * 反馈：被点按钮描边 + 屏上计数（便于截图核对 ✓）
 * 应急：★按 ESC 立刻关窗✗★（绝不把主人的屏幕占死 ✓）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const LAY = require('./layout');

const OUTDIR = 'C:/deepseek/gametest';
const CLICKS = path.join(OUTDIR, 'clicks.jsonl');
fs.mkdirSync(OUTDIR, { recursive: true });
try { fs.writeFileSync(CLICKS, ''); } catch (e) {}   // 每次启动清空 ✓（跑测试前先清 ✓）

const el = require('electron');
const { app, BrowserWindow, globalShortcut, screen, ipcMain } = el;
if (!app) { process.exit(1); }
app.disableHardwareAcceleration();
ipcMain.on('gametest:quit', () => { try { app.exit(0); } catch (e) {} });

function page() {
  const parts = [];
  for (const b of LAY.buttons) {
    const fill = b.kind === 'icon' ? '#2b3a55' : (b.kind === 'dup' ? '#4a3b22' : (b.kind === 'small' ? '#2f4f3f' : (b.kind === 'edge' ? '#553222' : '#333a44')));
    const inner = b.kind === 'icon'
      ? '<svg width="' + Math.round(b.w * 0.6) + '" height="' + Math.round(b.h * 0.6) + '"><circle cx="50%" cy="50%" r="40%" fill="#8fd3ff"/><rect x="20%" y="45%" width="60%" height="10%" fill="#ffe08a"/></svg>'
      : '<span>' + String(b.label).replace(/[<>&]/g, '') + '</span>';
    parts.push('<div class="btn k-' + b.kind + '" data-id="' + b.id + '" style="left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px;background:' + fill + '">' + inner + '</div>');
  }
  for (const r of LAY.noButtonRegions) {
    parts.push('<div class="nobtn" style="left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px">' + (r.fill === 'text' ? '这是一块纯文字区域：没有任何按钮。ABC 123 甲乙丙丁。' : '') + '</div>');
  }
  return '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'html,body{margin:0;padding:0;width:1920px;height:1080px;overflow:hidden;background:#12161c;color:#dfe6ef;'
    + 'font:16px "Microsoft YaHei",sans-serif;-webkit-user-select:none;cursor:crosshair}'
    + '.btn{position:absolute;display:flex;align-items:center;justify-content:center;border:1px solid #5a6a80;border-radius:6px;font-size:28px;text-align:center;overflow:hidden}'
    + '.btn.hit{border:4px solid #ffd166;box-shadow:0 0 18px #ffd166}'
    + '.nobtn{position:absolute;border:1px dashed #3d4655;color:#8a93a3;font-size:14px;display:flex;align-items:center;justify-content:center;background:#0d1116}'
    + '#hud{position:absolute;left:820px;top:8px;font-size:15px;color:#9fe6a0}'
    + '</style></head><body>' + parts.join('')
    + '<div id="hud">GameTest · clicks=0 · ESC=退出</div>'
    + '<script>let n=0;'
    + 'window.__click=function(ev,id,label,kind){n++;document.getElementById("hud").textContent="GameTest · clicks="+n+" · last="+id+" "+label+" · ESC=退出";'
    + 'const d=document.querySelector(\'[data-id="\'+id+\'"]\');if(d){d.classList.add("hit");}};'
    + 'document.addEventListener("mousedown",function(e){const t=e.target.closest(".btn");if(!t)return;'
    + 'window.__click(e,t.getAttribute("data-id"),t.textContent,t.className);'
    + 'window.gameTestLog({id:t.getAttribute("data-id"),x:e.clientX,y:e.clientY,sx:e.screenX,sy:e.screenY});},{capture:true});'
    + 'document.addEventListener("keydown",function(e){if(e.key==="Escape")window.gameTestQuit();});'
    + '</script></body></html>';
}

app.whenReady().then(() => {
  const d = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    x: 0, y: 0, width: LAY.width, height: LAY.height, frame: false, show: true,
    alwaysOnTop: true, skipTaskbar: false, title: LAY.title, backgroundColor: '#12161c',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page()));
  win.on('closed', () => app.exit(0));
  globalShortcut.register('Escape', () => { try { win.close(); } catch (e) {} app.exit(0); });
  console.log('gametest window ready ' + d.size.width + 'x' + d.size.height + ' scale=' + d.scaleFactor);
});

/* 预加载：把"写日志 / 退出"暴露给页面 ✓ */
module.exports = { CLICKS };
