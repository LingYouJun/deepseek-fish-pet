/* 遮挡问题复现 + 修复验证
 * electron.exe app\scripts\test-occlusion.js
 *
 * 用户报"她点不了开始游戏的按钮"。猜测是：桌宠窗是 alwaysOnTop，
 * 而 mouse_event 的点击只落到最上面那个窗口 —— 所以点在按钮位置上，
 * 实际点到的是桌宠窗。这里把这件事**复现出来**，再验证让开逻辑能解决。
 */
const path = require('path');
const fs = require('fs');
const { app, screen, BrowserWindow } = require('electron');
const REAL = path.join(process.env.APPDATA, 'dayu-pet');
const T = path.join(process.env.APPDATA, 'dayu-pet-occltest');
fs.mkdirSync(T, { recursive: true });
try {
  fs.copyFileSync(path.join(REAL, 'config.json'), path.join(T, 'config.json'));
  fs.copyFileSync(path.join(REAL, 'persona.json'), path.join(T, 'persona.json'));
} catch {}
try { fs.unlinkSync(path.join(T, 'clock-offset.json')); } catch {}
app.setPath('userData', T);
require('../main.js');

const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'body{margin:0;background:#123;height:100vh;display:flex;align-items:center;justify-content:center}'
  + '#go{font-size:28px;padding:30px 70px;background:#2b3a6b;color:#fff;border:3px solid #4d6bfe;border-radius:14px}'
  + '</style></head><body><button id="go" onclick="document.title=\'CLICKED\'">开始游戏</button></body></html>';

app.whenReady().then(async () => {
  const M = require('../main.js');
  const input = require('../src/input');
  const out = [];
  const L = (s) => { out.push(s); try { process.stdout.write(s + '\n'); } catch {} };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let pass = 0, total = 0;
  const check = (n, ok, d) => { total++; if (ok) pass++; L((ok ? '  ✅ ' : '  ❌ ') + n + (d ? '  ' + d : '')); };

  try {
    await wait(4500);
    const disp = screen.getPrimaryDisplay();
    const sp = input.space();
    const pet = M.win().petWin;
    check('桌宠窗在', !!(pet && !pet.isDestroyed()));

    const win = new BrowserWindow({ width: 600, height: 400, x: 120, y: 140, title: 'TARGET', alwaysOnTop: true, webPreferences: { nodeIntegration: false } });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
    await wait(2200);
    win.show(); win.focus(); await wait(900);

    const r = await win.webContents.executeJavaScript('(() => { const b = document.getElementById("go").getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}; })()');
    check('靶子按钮就位', r.w > 0, JSON.stringify(r));
    /* ⚠️ 必须用 getContentBounds()（内容区在屏幕上的位置），不能用 getPosition()：
       后者是**外框**左上角，标题栏还有约 31 DIP，直接用会整体点高一行 ——
       我第一版就是这么错的，导致"点不中"，白查了一轮。
       （渲染层的 window.screenX/Y 同样给的是外框，别用。） */
    const cb = win.getContentBounds();
    const btnDIP = { x: cb.x + r.x + r.w / 2, y: cb.y + r.y + r.h / 2 };
    const mx = Math.round(btnDIP.x / disp.size.width * sp.w), my = Math.round(btnDIP.y / disp.size.height * sp.h);
    L('  内容区原点 ' + JSON.stringify(cb) + '（外框 ' + JSON.stringify(win.getPosition()) + '）');
    L('  按钮中心: 屏幕DIP(' + Math.round(btnDIP.x) + ',' + Math.round(btnDIP.y) + ') → 模型(' + mx + ',' + my + ')');

    /* 把桌宠窗搬到按钮正上方（盖住它） */
    pet.setBounds({ x: Math.round(btnDIP.x) - 60, y: Math.round(btnDIP.y) - 60, width: 120, height: 120 });
    pet.show(); await wait(900);
    const pb = pet.getBounds();
    L('  桌宠窗现在在 ' + JSON.stringify(pb) + '  可见=' + pet.isVisible());
    const covering = btnDIP.x >= pb.x && btnDIP.x <= pb.x + pb.width && btnDIP.y >= pb.y && btnDIP.y <= pb.y + pb.height;
    check('桌宠窗确实盖住了按钮（复现前提）', covering, JSON.stringify(pb));

    L('');
    L('=== A. 不让开 → 应该点不中（复现用户报的现象）===');
    input.click(mx, my);
    await wait(1000);
    L('  靶子标题 = ' + win.getTitle());
    check('★ 不让开时点不中（标题仍是 TARGET）', win.getTitle() === 'TARGET', win.getTitle());

    L('');
    L('=== B. 让开逻辑：目标点被盖住时应返回被藏的窗口 ===');
    const yielded = M.yieldOwnWindowsAt('click', mx + ',' + my);
    await wait(500);
    L('  yieldOwnWindowsAt 返回 ' + (yielded ? yielded.length + ' 个窗口' : 'null') + '，桌宠窗可见=' + pet.isVisible());
    check('★ 检测到遮挡并让开', !!yielded && yielded.length === 1, String(yielded && yielded.length));
    check('★ 桌宠窗已经藏起来', pet.isVisible() === false);

    L('');
    L('=== C. 让开之后 → 应该点得中 ===');
    input.click(mx, my);
    await wait(1000);
    L('  靶子标题 = ' + win.getTitle());
    check('★ 让开后点中了（标题变 CLICKED）', win.getTitle() === 'CLICKED', win.getTitle());

    L('');
    L('=== D. 放回来 ===');
    M.restoreOwnWindows(yielded);
    await wait(700);
    check('★ 桌宠窗恢复了', pet.isVisible() === true, 'visible=' + pet.isVisible());

    L('');
    L('=== E. 目标点没被盖住时不该乱藏 ===');
    pet.setBounds({ x: 5, y: 5, width: 100, height: 100 });
    await wait(600);
    const y2 = M.yieldOwnWindowsAt('click', mx + ',' + my);
    check('没遮挡时返回 null（不乱藏）', y2 === null, String(y2));
    check('桌宠窗仍在', pet.isVisible() === true);

    L('');
    L('=== F. 非鼠标类工具不该触发让开 ===');
    for (const tool of ['read_file', 'screen_shot', 'type', 'skill_ls']) {
      const y3 = M.yieldOwnWindowsAt(tool, '1,1');
      check(tool + ' 不触发让开', y3 === null, String(y3));
    }
    check('参数里没坐标也不触发', M.yieldOwnWindowsAt('click', 'nonsense') === null);

    try { win.destroy(); } catch {}
    try { pet.show(); } catch {}
    L('');
    L('  通过 ' + pass + ' / ' + total);
  } catch (e) {
    var crashed = String((e && e.stack) || e);
    L('ERROR: ' + crashed);
  }
  console.log(out.join('\n'));
  setTimeout(() => app.exit((pass === total && !crashed) ? 0 : 1), 300);
});
