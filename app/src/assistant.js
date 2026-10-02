const { app, shell, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');   // OCR 收 stdout 用（见 ocr() 的注释）
const web = require('./web');
const screenstream = require('./screenstream');
const input = require('./input');
const vision = require('./vision');
const config = require('./config');
const skills = require('./skills');
const style = require('./style');
const projects = require('./projects');
const personatags = require('./personatags');

// 每个工具所需的最低权限档
const TOOL_TIER = {
  list_dir: 'read', read_file: 'read', use_skill: 'read', skill_ls: 'read', skill_read: 'read',
  write_file: 'full',    // 写任意绝对路径
  run_file: 'full',      // 跑任意绝对路径的脚本
  focus_window: 'full',  // 把窗口抬到最前（被别的窗口挡住时用）
  windows_list: 'full',  // 列出可见窗口（标题+位置尺寸，已换算成截图空间）
  make_template: 'full', // 从当前画面裁一块存成模板
  find_template: 'full', // 用模板匹配精确定位（替代让模型估坐标）
  template_list: 'read', template_del: 'normal',
  find_text: 'full',   // OCR 当前画面找一段文字并返回坐标（文字的模板匹配）
  find_template_scroll: 'full',  // 在列表里边滚边找模板，找不到会滚回原位
  proj_ls: 'read', proj_read: 'read', tag_list: 'read',
  open_path: 'normal', open_url: 'normal', skill_write: 'normal', skill_rm: 'normal', proj_rm: 'normal', proj_open: 'normal', proj_run: 'normal', proj_write: 'normal',
  tag_set: 'normal', tag_rm: 'normal',
  web_open: 'web', web_click: 'web', web_type: 'web', web_read: 'web',
  screen_shot: 'full', screen_look: 'full',
  click: 'full', rclick: 'full', dclick: 'full', move: 'full', drag: 'full', scroll: 'full', type: 'full', key: 'full',
  clickz: 'full', movez: 'full', rclickz: 'full', dclickz: 'full',
  game_start: 'full', game_stop: 'read', game_status: 'read',
};
const RANK = { off: 0, read: 1, normal: 2, web: 3, full: 4 };

function allowed(tier, tool) {
  // 停手和查状态永远允许：万一权限被调低，也得能让她把游戏助手停下来
  if (tool === 'game_stop' || tool === 'game_status') return true;
  const need = TOOL_TIER[tool];
  return !!need && (RANK[tier] || 0) >= RANK[need];
}

/* ---------------- 全屏截图（主屏） ----------------
   优先走连续屏幕流（抓一帧 ~50ms），流起不来退回 desktopCapturer（~650ms）。 */
function shotsDir() {
  const d = path.join(app.getPath('userData'), 'shots');
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

async function captureScreen(withGrid, noCursor) {
  const frame = await screenstream.grabFrame({ grid: !!withGrid, noCursor: !!noCursor });
  if (frame && frame.dataUrl) {
    const p = path.join(shotsDir(), 'screen-' + Date.now() + '.jpg');
    fs.writeFileSync(p, Buffer.from(frame.dataUrl.split(',')[1], 'base64'));
    return { path: p, width: frame.width, height: frame.height, dataUrl: frame.dataUrl };
  }
  return captureScreenFallback();
}

async function captureScreenFallback() {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;                 // DIP 尺寸
  const scale = primary.scaleFactor || 1;
  const tw = Math.round(width * scale), th = Math.round(height * scale);   // 物理像素，更清晰
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: tw, height: th } });
  let src = sources[0];
  const match = sources.find((s) => s.display_id === String(primary.id));
  if (match) src = match;
  /* 关键：整条链路（提示词、input.norm）都约定坐标空间是 1280x720，
     而回退路径原来返回的是物理分辨率（1920x1080 / 2560x1440）→ 模型按图上的像素报坐标
     会被 norm() 静默钳到屏幕右下角，点错位置还回"✅ 已点击"。
     这里直接缩放到 1280x720，让两条路径的坐标空间完全一致。 */
  const png = src.thumbnail.resize({ width: require('./input').space().w, height: require('./input').space().h }).toPNG();

  const p = path.join(shotsDir(), 'screen-' + Date.now() + '.png');
  fs.writeFileSync(p, png);
  const _s2 = require('./input').space();
  return { path: p, width: _s2.w, height: _s2.h, dataUrl: 'data:image/png;base64,' + png.toString('base64') };
}

/* OCR 的 JSON 模式：除了文字，还要每个词的包围盒 —— 这是 find_text 定位的依据。
 * Windows OCR 的 $result.Text 有个坑：CJK 会被它当"词"，于是在每个汉字之间插空格，
 * 而且**完全丢掉了位置**。所以定位必须走 ocr.ps1 -Json（Lines/ Words/ BoundingRect）。
 * 坐标系：包围盒是**送进图片的像素坐标**，我们送的就是 1920x1080 的全屏抓帧 → 直接可用。 */
function ocrJson(pngPath) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, '..', 'scripts', 'ocr.ps1');
    let child, done = false, out = '', err = '';
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', pngPath, '-Json'],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { return fin(null); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} fin(null); }, 25000);
    const dec = new StringDecoder('utf8');
    child.stdout.on('data', (d) => { if (out.length < 400000) out += dec.write(d); });
    child.stderr.on('data', (d) => { if (err.length < 4000) err += dec.write(d); });
    child.on('error', () => { clearTimeout(timer); fin(null); });
    child.on('close', () => {
      clearTimeout(timer);
      const s = String(out || '').trim();
      const i = s.indexOf('{');
      if (i < 0) return fin(null);
      try { const j = JSON.parse(s.slice(i)); return fin(j && j.ok ? j : null); } catch { fin(null); }
    });
  });
}

/* 在 OCR 结果里找一段文字，返回它的中心坐标（截图空间）。
 * 为什么要做这个：模板匹配能精确找"图"，但**不认字** —— 而游戏里大量目标只有文字
 * （干员名、设施名、列表项）。这个函数就是"文字的模板匹配"。
 * 匹配规则：把每行的词**首尾相连**（OCR 会在汉字间插空格，所以要先归一化），
 *   在归一化后的行文本里找目标子串，再把命中的字符区间映射回对应词的包围盒并求并集。
 * 这样即使目标被 OCR 拆成多个"词"（"进驻" + "总览"），也能整体命中。 */
function findTextInOcr(j, needle) {
  const target = String(needle || '').replace(/\s+/g, '');
  if (!target) return null;
  const lines = (j && j.lines) || [];
  for (const ln of lines) {
    const words = ln.words || [];
    if (!words.length) continue;
    /* 归一化：拼出"字符 -> 词索引"的映射 */
    let joined = '';
    const map = [];
    for (let wi = 0; wi < words.length; wi++) {
      const t = String(words[wi].t || '').replace(/\s+/g, '');
      for (let ci = 0; ci < t.length; ci++) { joined += t[ci]; map.push(wi); }
    }
    const at = joined.indexOf(target);
    if (at < 0) continue;
    const w0 = map[at], w1 = map[Math.min(map.length - 1, at + target.length - 1)];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let wi = w0; wi <= w1 && wi < words.length; wi++) {
      const w = words[wi];
      x0 = Math.min(x0, w.x); y0 = Math.min(y0, w.y);
      x1 = Math.max(x1, w.x + w.w); y1 = Math.max(y1, w.y + w.h);
    }
    if (!Number.isFinite(x0)) continue;
    return {
      x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2),
      box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      line: String(ln.text || ''), chars: target.length,
    };
  }
  return null;
}

/* Windows 自带 OCR（离线，支持中英文）。失败返回空串，不影响截图展示。
 *
 * 必须**异步**：以前用 spawnSync，主进程事件循环被整个占住——实测单次 420~570ms，
 * 期间宠物窗和对话窗完全点不动；多步看屏任务会一路卡顿。现在改成 spawn + Promise，
 * 上限仍是 25 秒，但不再阻塞任何东西。 */
function ocr(pngPath) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, '..', 'scripts', 'ocr.ps1');
    let child, done = false, out = '', err = '';
    const fin = (t) => { if (!done) { done = true; resolve(t || ''); } };
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', pngPath],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { return fin(''); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} fin(''); }, 25000);
    /* 用 StringDecoder 而不是 `out += d`：后者是**逐块隐式 toString('utf8')**，
       一个中文字被切在两次 data 事件之间就会解出 U+FFFD 乱码
       （projects.js 里踩过同一个坑，那边也是这么修的）。
       配合 ocr.ps1 里设的 UTF-8 输出编码，中文才不乱。 */
    const dec = new StringDecoder('utf8');
    child.stdout.on('data', (d) => { if (out.length < 40000) out += dec.write(d); });
    child.stderr.on('data', (d) => { if (err.length < 4000) err += dec.write(d); });
    child.on('error', () => { clearTimeout(timer); fin(''); });
    child.on('close', (code) => {
      clearTimeout(timer);
      /* 以前把 stdout + stderr 直接拼起来返回，于是 powershell 的报错文本会被当成
         "屏幕上识别到的文字"喂给模型（第 89 / 115 行）。现在失败一律当"没识别到"，
         并且把混在 stdout 里的报错行剔掉。 */
      if (code !== 0) {
        if (err.trim()) { try { console.error('[ocr] ' + err.slice(0, 300)); } catch {} }
        return fin('');
      }
      const lines = String(out).split(/\r?\n/).filter((l) =>
        !/^\s*(At line:|\+ |CategoryInfo|FullyQualifiedErrorId|Exception|MethodInvocationException|MissingMethodException)/.test(l));
      fin(lines.join('\n').trim());
    });
  });
}

/* 只读文件开头 n 个字符（用 fd 定位读，不把整个文件读进内存）。
   截断时按字符边界收一下，避免最后半个多字节字符变乱码。 */
function readHead(file, n) {
  const cap = Math.max(100, Number(n) || 3000);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(cap * 4);            // 按 UTF-8 最坏 4 字节/字符留量
    const got = fs.readSync(fd, buf, 0, buf.length, 0);
    let s = buf.slice(0, got).toString('utf8');
    if (s.length > cap) s = s.slice(0, cap);
    return s + (got >= buf.length ? '\n…（文件很大，只读了开头）' : '');
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

/* 最近一次"放大看"的参数，用来把放大图坐标换算回整屏坐标。
   为什么放在模块级：她"看"和"点"是两次独立调用（screen_look 之后才是 click），
   中间必须记住那块区域的偏移和缩放比。非放大的一次 screen_look 会把它清掉。 */
let ZoomState = null;
function zoomOut(x, y) {
  if (!ZoomState) return [x, y];
  try { return [Math.round(ZoomState.x + x / ZoomState.k), Math.round(ZoomState.y + y / ZoomState.k)]; }
  catch { return [x, y]; }
}

async function run(tool, arg) {
  arg = String(arg == null ? '' : arg).trim();
  if (!TOOL_TIER[tool]) throw new Error('未知操作：' + tool);

  if (tool.startsWith('web_')) return web.run(tool, arg);

  if (tool === 'screen_shot') {
    /* ⚠️ OCR 用图**不要画坐标网格**：那些刻度数字会被 OCR 当成屏幕上的文字读进去。
       网格只给视觉模型定位用（见下面的 screen_look）。 */
    const cap = await captureScreen(false);
    const text = await ocr(cap.path);
    const result = '🖥 已截取屏幕（' + cap.width + '×' + cap.height + '）\n'
      + (text ? '屏幕上识别到的文字：\n' + text : '（未识别到文字；截图已展示在对话里，你可以自己看）');
    return { text: result, image: cap.dataUrl, path: cap.path, ocr: text };
  }

  if (tool === 'screen_look') {
    /* 分段计时：抓帧 / 视觉 / OCR 各花了多久。
       "看屏幕要 6-7 秒太慢"这种问题，光看总耗时是没法优化的 ——
       实测抓帧热态只要 22ms、视觉 API 约 1.7s，加起来远小于总耗时，
       说明大头在别处。所以把每段都打出来，别猜。 */
    const timing = {};
    const tick = () => Date.now();
    const tCap = tick();
    /* 视觉这条路**要画坐标网格**：实测模型"估位置"在贴边处能差近 300px
       （鹰角启动器右下角按钮真实 (1837,1025)，它给 (1500,807)），
       有了刻度它就能"读"坐标而不是"估"。 */
    /* 放大看时**不要网格**：实测"网格 + 整屏换算"把她绕晕了 ——
       她自己报的："放大后视觉模型说编辑队列在约 (2200,600)，已经超出 1920 宽的屏幕范围"。
       放大图只让她按【放大图自己的像素坐标】报，换算由程序做（见 ZoomState / zoomConvert）。 */
    const zoomPre = (function () { try { return /\|\|\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(String(arg || '')); } catch { return false; } })();
    /* 放大看时**走无损的 PNG 路径**：帧流是 JPEG，把它的压缩噪点放大 3 倍只会更糊 ——
       实测她的原话："这几张放大图太糊，我定不准卡片坐标"。PNG 那条路径
       （desktopCapturer 原生图 → resize → PNG）是无损的，放大出来的字是锐利的。 */
    const cap = zoomPre ? await captureScreenFallback() : await captureScreen(true);
    if (!zoomPre) ZoomState = null;   // 普通看屏幕：清掉上一次的放大参数
    timing.captureMs = tick() - tCap;
    /* 【局部放大】用户点出的真问题："这不是游戏问题，而是你给她分辨率太低了"。
       实测：抓帧确实是 1920x1080（= 物理屏 1:1，不能再高），但**整屏只有 207 万像素**，
       游戏里一个小按钮才 ~40px，经视觉 API 再压一次就剩 ~30px
       → 于是同一个按钮她连续几次读出的坐标差 20~120px，怎么点都打不中。
       修法不是提高抓帧（已经到顶），而是**把要看的区域裁出来放大**：
       例如裁 640x360 放大到 1920 → 那个按钮在模型眼里变成 ~120px，坐标精度上一个数量级。
       用法：screen_look|<问题>||<x,y,w,h>   （x,y,w,h 是全屏 1920x1080 坐标） */
    let capDataUrl = cap.dataUrl;
    let zoomInfo = null;
    try {
      const mm = String(arg || '').match(/\|\|\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/);
      if (mm) {
        const _s = require('./input').space();
        const rx = Math.max(0, Math.min(_s.w - 40, Number(mm[1])));
        const ry = Math.max(0, Math.min(_s.h - 40, Number(mm[2])));
        const rw = Math.max(40, Math.min(_s.w - rx, Number(mm[3])));
        const rh = Math.max(40, Math.min(_s.h - ry, Number(mm[4])));
        const { nativeImage } = require('electron');
        const img = nativeImage.createFromDataURL(cap.dataUrl).crop({ x: rx, y: ry, width: rw, height: rh });
        const scaled = img.resize({ width: Math.min(1920, rw * 3), quality: 'best' });
        capDataUrl = scaled.toDataURL();
        zoomInfo = { x: rx, y: ry, w: rw, h: rh, scale: Math.round(Math.min(1920, rw * 3) / rw * 10) / 10, k: Math.min(1920, rw * 3) / rw };
        /* 记住它：她"看"和"点"是两次独立调用，中间必须靠它把放大图坐标换算回整屏坐标 */
        ZoomState = { x: rx, y: ry, k: zoomInfo.k };
        zoomInfo.outW = Math.min(1920, rw * 3);
        zoomInfo.outH = Math.round(rh * zoomInfo.k);
      }
    } catch (e) { zoomInfo = null; }
    const cfg = config.load();
    let text = '';
    let usedVision = false;
    let visionErr = '';
    let action = null;
    if (cfg.visionEnabled) {
      const _sp = require('./input').space(); const CAPW = _sp.w, CAPH = _sp.h; const CAPEX = Math.round(_sp.w / 2), CAPEY = Math.round(_sp.h / 2);
      /* ⚠️ 这段必须是**模板串（反引号）**：里面用了 ${CAPW}/${CAPH}/${CAPEX}/${CAPEY}。
         之前写成了单引号 → 占位符没被插值，**模型看到的字面就是 "${CAPW}x${CAPH}"**，
         于是它照着写 `click|${CAPW-20},${CAPH-20}` 被拒（"坐标格式应为 x,y"），白费一步。
         这是监视数据里从她的报错里挖出来的，不是什么模型犯傻。 */
      /* ⚠️ 坐标空间必须**随放大与否切换**：这一段原来写死"坐标基于 1920x1080 截图"，
         结果放大时模型仍按整屏空间报数（实测：480x360 的裁剪区，它报了 (530,580)），
         换算除下来就是 (177,193) 那种落在左上角的错点 —— 她连续两次点错就卡住了。
         这正是她自己报出来的："裁剪区是 480×360，但模型报的是 (530,580)，已经超出裁剪区"。 */
      const SPACE = zoomInfo
        ? { w: zoomInfo.outW, h: zoomInfo.outH, name: '放大图', ex: Math.round(zoomInfo.outW / 2) + ',' + Math.round(zoomInfo.outH / 2) }
        : { w: CAPW, h: CAPH, name: '整屏截图', ex: CAPEX + ',' + CAPEY };
      const _zoomNote = zoomInfo
        ? ('\n\n【重要】这一张是**放大图**：它是屏幕区域 (' + zoomInfo.x + ',' + zoomInfo.y + ') 起 '
           + zoomInfo.w + 'x' + zoomInfo.h + ' 裁出来放大的，放大倍数约 ' + zoomInfo.scale
           + '，**这张图本身的尺寸是 ' + zoomInfo.outW + 'x' + zoomInfo.outH + '**。\n'
           + '**请直接按这张放大图自己的像素坐标输出，并用 clickz 这个工具**：\n'
           + '  例如"按钮在这张图里约 (900,400)"就写 **ACTION: clickz|900,400**\n'
           + '  （clickz 表示"这是放大图里的坐标"；普通的 click 永远按整屏坐标算，两者不要混用。）\n'
           + '  另外还有 movez / rclickz / dclickz，用法同 clickz。\n'
           + '**不要自己换算成整屏坐标，也不要用 1920x1080 这个数字** —— 换算由程序做。')
        : '';
      const q = (arg || '看看屏幕') + _zoomNote + `\n\n【读坐标的方法】图上画了**刻度网格**（每格 240x135），边上黄色数字就是那条线的像素坐标（左上角写着 0,0，右下角写着 ${CAPW},${CAPH}）。请**顺着网格读出**目标在哪一格，再判断它在格内的相对位置 —— 不要凭感觉估：实测凭感觉在贴近屏幕边缘时能差 300 像素。

【输出要求】先用一句中文说明你的判断；如果这一步需要操作屏幕，就在回答的最后单独输出一行：ACTION: 工具|参数（坐标基于 ${SPACE.name}，这个空间的尺寸是 ${SPACE.w}x${SPACE.h}，左上角 0,0；工具可选 click/rclick/dclick/move/drag/scroll/type/key，例如 ACTION: click|${SPACE.ex}）。如果不需要操作就不要写 ACTION 行。`;
      /* tV 必须声明在 try **外面**：catch 里也要用它算耗时，
         写在 try 内的话失败路径会 ReferenceError（实测被 §6 那条测试抓住）。 */
      let tV = tick();
      try {
        text = await vision.describe(cfg, capDataUrl, q, cfg.visionDetail || 'high');
        timing.visionMs = tick() - tV;
        usedVision = true;
        const m = text.match(/ACTION\s*[:：]\s*([a-z_]+)\s*\|\s*(.+)/i);
        if (m) {
          const t = m[1].trim().toLowerCase();
          if (TOOL_TIER[t]) action = { tool: t, arg: m[2].trim() };
        }
      } catch (e) {
        /* ⚠️ 这里以前是 `text = ''`，**把视觉失败完全吞掉**：key 过期 / 余额不足 /
         * 网络不通，全都表现成"降级成 OCR"，用户和模型都不知道出了什么事，
         * 还会一直重复调。现在把原因记下来、一并报回去（翻译过的可读版本由 vision.js 给）。 */
        timing.visionMs = tick() - tV;
        visionErr = String((e && e.message) || e);
        text = '';
      }
    }
    if (!text) {
      const tO = tick();
      const t = await ocr(cap.path);
      timing.ocrMs = tick() - tO;
      text = t ? ('屏幕上识别到的文字：\n' + t) : '（未识别到文字）';
      if (visionErr) text += '\n\n⚠️ 视觉模型调用失败，已降级为 OCR：' + visionErr;
      else if (!cfg.visionEnabled) text += '\n\n（config.json 里 visionEnabled 是关的，所以没走视觉模型）';
    }
    return {
      text: (usedVision ? '👁 视觉模型：\n' : '🖥 屏幕文字：\n') + text,
      image: cap.dataUrl, path: cap.path, action, visionErr, timing,
    };
  }

  // 这几个允许空参数（列根目录 / 停手 / 查状态），其它需要参数的工具才拦
  const NOARG = { skill_ls: 1, proj_ls: 1, game_stop: 1, game_status: 1, screen_shot: 1, web_read: 1 };
  if (!arg && !NOARG[tool]) throw new Error('操作参数为空');
  if (tool === 'open_url') {
    if (!/^https?:\/\//i.test(arg)) throw new Error('网址需以 http(s):// 开头');
    await shell.openExternal(arg);
    return `✅ 已打开网页：${arg}`;
  }
  if (tool === 'open_path') {
    /* 注意：这里用系统默认处理器打开，**等于能运行任意程序**（.exe/.bat/.vbs/.hta 都会被执行），
       normal 档就能用。proj_run 的"解释器白名单"只约束 proj_run，不代表这一档只能跑白名单内的东西。 */
    const err = await shell.openPath(arg);
    if (err) throw new Error(err);
    return `✅ 已打开：${arg}`;
  }
  if (tool === 'list_dir') {
    const items = fs.readdirSync(arg).slice(0, 80);
    return `📂 ${arg}（${items.length} 项）：\n${items.join('\n')}`;
  }
  if (tool === 'read_file') {
    /* 只读前 3000 字。以前是 readFileSync 整读再 slice——模型给个大文件路径
       （C:\Windows\Logs\CBS\CBS.log、视频、hiberfil.sys）主进程就同步卡死+内存暴涨，
       而且 read 档就能调用，用户很容易点"允许"。 */
    const text = readHead(arg, 3000);
    return `📄 ${arg}：\n${text}`;
  }
  if (tool === 'write_file') {
    /* 【为什么加它】实测发现的能力缺口：
     * 主人说"在 C:\deepseek\pet-test 下新建 hello.txt"，
     * 而当时**只有** proj_write 能写文件，它是**沙盒内**的（相对路径、落在
     * %APPDATA%\<app>\projects\ 下）—— 于是她"换个地方写完 + 报成功"，
     * 主人去指定目录一看什么都没有，就成了"她说了做了其实没做"。
     * 现在补一个**绝对路径**的写入（和 read_file/list_dir 同一族，权限档 full），
     * 让"写到主人指定的目录"这件事真的做得成。
     *
     * 安全边界：只允许绝对路径（相对路径一律拒绝，免得又落进沙盒让人误解）；
     * 单次内容上限 200KB；写入前把父目录建出来；返回**绝对路径**，让主查看得见落点。 */
    const raw = String(arg || '');
    const i = raw.indexOf('||');
    if (i < 0) throw new Error('格式：write_file|C:\\完整\\路径\\文件名||文件内容');
    const p = raw.slice(0, i).trim().replace(/^["']|["']$/g, '');
    const content = raw.slice(i + 2);
    if (!path.isAbsolute(p)) {
      throw new Error('write_file 需要**绝对路径**（例如 C:\\deepseek\\pet-test\\hello.txt）。'
        + '如果你是想写到自己的项目沙盒里，请改用 proj_write|<相对路径>||<内容>。收到的是：' + p);
    }
    if (Buffer.byteLength(content, 'utf8') > 200 * 1024) throw new Error('内容超过 200KB，太大了');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
    return '💾 已写入：' + p + '（' + Buffer.byteLength(content, 'utf8') + ' 字节）';
  }

  /* ---------------- 技能：按需加载完整说明 ---------------- */
  if (tool === 'use_skill') {
    const s = skills.read(arg);
    if (!s) {
      const ids = skills.list().map((x) => x.id).join('、') || '(暂无)';
      throw new Error('没有这个技能：' + arg + '。可用技能：' + ids);
    }
    let out = '📘 技能「' + s.name + '」\n' + s.body;
    if (s.memory && s.memory.length) {
      const facts = s.memory.slice().sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0)).slice(0, 10);
      out += '\n\n【这个技能积累下来的经验】\n' + facts.map((f) => '- ' + f.text).join('\n');
    }
    // 界面风格这一个技能要跟"记忆"联动：加载时按当前好感度/心情微调冷暖
    if (s.id === style.SKILL_ID) {
      try {
        const hint = style.moodHint(require('./mood').load());
        if (hint) out += '\n\n【当前状态微调（记忆联动）】\n' + hint;
      } catch {}
    }
    return out;
  }

  /* ---------------- 技能目录的自主管理（AI 自己整理经验） ---------------- */
  if (tool === 'skill_ls') {
    const items = skills.ls(arg || '');
    return '📂 技能目录 ' + (arg || '/') + '（' + items.length + ' 项）：\n' + (items.join('\n') || '(空)');
  }
  if (tool === 'skill_read') {
    const r = skills.readFile(arg || '');
    return '📄 ' + arg + (r.truncated ? '（只显示前 6000 字，共 ' + r.size + ' 字）' : '') + '：\n' + r.text;
  }
  if (tool === 'skill_write') {
    const s = String(arg || '');
    const i = s.indexOf('||');
    if (i < 0) throw new Error('格式：skill_write|技能/子路径/文件.md||内容');
    const rel = s.slice(0, i).trim();
    // 允许用 \n 写换行（ACTION 只能是一行）
    const content = s.slice(i + 2).replace(/\\n/g, '\n');
    const r = skills.writeFile(rel, content);
    return '💾 已写入技能文件：' + r.path + '（' + r.bytes + ' 字节）';
  }
  if (tool === 'skill_rm') {
    const r = skills.remove(arg || '');
    return '🗑 已删除：' + r.path;
  }
  /* 项目文件写入。
   * 为什么必须单独开一个工具：以前项目文件**只能**靠回复里的 <<<WRITE: 路径 …>>> 块创建，
   * 而那个语法只写在"首轮系统提示词"里 —— 多步任务续跑用的是精简提示词（buildContinuePrompt），
   * 里面完全没提 WRITE 块。于是续跑阶段她手上**唯一像写入的工具就是 skill_write**：
   * 实测她把算乘法的 `calc/mul.py` 写进了**技能文件夹**，还返回"已写入技能文件"一路成功、
   * 不报任何错 —— 属于"看着正常其实写错地方"。补上 proj_write 后续跑阶段也有正确落盘方式。 */
  if (tool === 'proj_write') {
    const s = String(arg || '');
    const i = s.indexOf('||');
    if (i < 0) throw new Error('格式：proj_write|子路径/文件.py||文件内容');
    const rel = s.slice(0, i).trim();
    const content = s.slice(i + 2).replace(/\\n/g, '\n');   // ACTION 只能一行，允许用 \n 写换行
    const r = projects.writeOne(rel, content);
    return '💾 已写入项目文件：' + r.path + '（' + r.bytes + ' 字节）';
  }

  /* ---------------- 人格词条（她自己的"人格词典"，也是将来换立绘的 key） ---------------- */
  if (tool === 'tag_list') {
    return '🏷 当前人格词条表（tier1 核心人格 = 立绘 key）：\n' + personatags.vocabulary();
  }
  if (tool === 'tag_set') {
    const s = String(arg || '');
    const i = s.indexOf('{');
    if (i < 0) throw new Error('格式：tag_set|{"id":"yandere","label":"病娇","tier":1,"moodDir":1,"words":["病娇","偏执"]}');
    let o;
    try { o = JSON.parse(s.slice(i)); } catch { throw new Error('JSON 解析失败（检查引号、逗号、不要换行）'); }
    const r = personatags.setTag(o);
    if (!r.ok) throw new Error(r.error);
    return '🏷 已' + (r.action === 'added' ? '新增' : '更新') + '词条「' + r.tag.label + '」(' + r.tag.id
      + '，tier' + r.tag.tier + '，词：' + r.tag.words.join('/') + ')，词条表共 ' + r.total + ' 条。'
      + (r.tag.tier === 1 ? '（tier1 = 核心人格，会影响立绘与行为方向）' : '');
  }
  if (tool === 'tag_rm') {
    const r = personatags.removeTag(arg);
    if (!r.ok) throw new Error(r.error);
    return '🗑 已删除词条「' + r.removed.label + '」(' + r.removed.id + ')，词表剩 ' + r.total + ' 条。';
  }

  /* ---------------- 项目文件夹（她写的小软件放这儿） ---------------- */
  if (tool === 'proj_ls') {
    const items = projects.ls(arg || '');
    return '📂 项目目录 ' + (arg || '/') + '（' + items.length + ' 项）：\n' + (items.join('\n') || '(空)');
  }
  if (tool === 'proj_read') {
    const r = projects.readFile(arg || '');
    return '📄 ' + arg + (r.truncated ? '（只显示前 8000 字，共 ' + r.size + ' 字）' : '') + '：\n' + r.text;
  }
  if (tool === 'proj_rm') {
    const r = projects.remove(arg || '');
    return '🗑 已删除：' + r.path;
  }
  if (tool === 'proj_open') {
    const r = await projects.open(arg || '');
    return '🌐 已用默认程序打开：' + r.path;
  }
  if (tool === 'proj_run' || tool === 'run_file') {
    const cfgR = config.load();
    /* run_file = 同一套执行器，但**允许绝对路径**（权限档 full 才挂得上）。
       为什么加：实测主人说"帮我跑一下 C:\deepseek\pet-test\calc.py"，
       而当时只有沙盒内的 proj_run —— 她把绝对路径传进去只收到"路径越界"，
       于是判断"文件不存在"，最后如实告诉主人"文件不在"（其实是错的）。
       现在「跑主人指定的脚本」这件事有了正确出口。 */
    const r = await projects.run(arg || '', (cfgR.memory || {}).projRunTimeout || 60000, tool === 'run_file');
    const head = r.timeout
      ? '⏱ 运行超时被强制结束（' + Math.round(r.ms / 1000) + 's）'
      : (r.code === 0 ? '✅ 运行成功（' + Math.round(r.ms / 1000) + 's，退出码 0）' : '❌ 运行出错（退出码 ' + r.code + '，' + Math.round(r.ms / 1000) + 's）');
    return head + '：' + r.path + '\n--- 输出 ---\n' + r.output;
  }

  /* ---------------- 游戏助手（默认关闭，用户开口才启动） ----------------
     懒加载：gameagent 自己依赖 assistant，放在函数里 require 避免循环依赖。 */
  if (tool === 'game_start' || tool === 'game_stop' || tool === 'game_status') {
    const game = require('./gameagent');
    if (tool === 'game_status') {
      const s = game.status();
      if (!s.running) return '🎮 游戏助手（替你打游戏的那个循环）现在**没有在运行**。\n'
        + '注意：这只表示"我没在帮打"，**不代表游戏本身开没开** —— 游戏开没开要看屏幕（用 screen_look 或 screen_shot）。';
      return '🎮 正在打：第 ' + s.step + ' / ' + s.maxSteps + ' 步，已操作 ' + (s.tally.act || 0) + ' 次'
        + '（成功 ' + (s.tally.ok || 0) + ' / 失败 ' + (s.tally.fail || 0) + '）\n任务：' + s.task;
    }
    if (tool === 'game_stop') {
      const r = game.stop();
      return r.already
        ? '🎮 游戏助手本来就没在运行，不用停（这不代表游戏没开着）。'
        : '🛑 已经让她停手了，正在收尾（一两秒内就完全停下）。';
    }
    const s = String(arg || '');
    const i = s.indexOf('||');
    const task = (i >= 0 ? s.slice(0, i) : s).trim();
    const maxSteps = i >= 0 ? (Number(s.slice(i + 2)) || 0) : 0;
    const r = await game.start({ task, maxSteps: maxSteps || undefined });
    if (!r || !r.ok) throw new Error((r && r.error) || '启动失败');
    return '🎮 已经开打了，她在持续盯屏操作，每一步都会汇报到对话里。\n任务：' + task.slice(0, 120)
      + '\n（**不需要再调 game_start**：现在只要用正常格式跟主人说一声你已经上手了、想停就说「停」。用户说停的时候再调 game_stop。）';
  }

  /* ---------------- OS 级键鼠（坐标 = 抓帧空间，见 input.space()） ---------------- */
  const parseXY = (s) => {
    const m = String(s || '').trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) throw new Error('坐标格式应为 x,y');
    return [Number(m[1]), Number(m[2])];
  };
  if (tool === 'click' || tool === 'rclick' || tool === 'dclick' || tool === 'move') {
    /* 如果她上一眼是【放大图】，她报的是放大图自己的坐标 —— 这里换算回整屏。 */
    /* ⚠️ click 永远是【整屏坐标】，绝不自动换算。
       第一版这里写的是 zoomOut.apply(...) —— 只要 ZoomState 还在就一律换算，
       而她做过一次放大之后，**后面所有整屏坐标的点击都被错误换算了一遍**：
       她自己报过"我瞄 1370,300，实际落在 1628,509"（差 250px）。
       也就是说之前统计的"坐标漂移 20~120px"，相当一部分是我这个隐藏状态造成的，不是模型飘。 */
    const [x, y] = parseXY(arg);
    const label = { click: '左键点击', rclick: '右键点击', dclick: '双击', move: '移动鼠标' }[tool];
    input[tool](x, y);
    /* 【等界面反应完再返回】实测踩到的坑：她点"基建"之后**立刻** screen_look，
       而游戏切界面要 1~2 秒 —— 她看到的是**旧画面**，于是判断"没点进去"、
       换个坐标再点、再点，连点三次（日志里就是 1320,878 → 1512,810 → 1480,830），
       而其实现第二次就进去了。不该让她靠"记得等一下"来避免：
       点/按键/输入/拖拽这类**会改变界面**的动作，返回前统一等一小会儿，
       这样下一步截图看到的才是动作之后的状态。move 不改界面，不用等。 */
    if (tool !== 'move') {
      const settle = Number((config.load().memory || {}).actionSettleMs) || 1500;
      await new Promise((r) => setTimeout(r, settle));
      return `✅ 已${label}：(${x}, ${y})（已等 ${(settle / 1000).toFixed(1)}s 让界面反应）`;
    }
    return `✅ 已${label}：(${x}, ${y})`;
  }
  if (tool === 'clickz' || tool === 'movez' || tool === 'rclickz' || tool === 'dclickz') {
    if (!ZoomState) return '⚠️ 现在没有有效的放大图（上一次 screen_look 不是放大看）。请先用 screen_look|<问题>||x,y,w,h 放大看一次，或改用普通的 click（整屏坐标）。';
    const [zx, zy] = parseXY(arg);
    const [x, y] = [Math.round(ZoomState.x + zx / ZoomState.k), Math.round(ZoomState.y + zy / ZoomState.k)];
    const real = tool.replace(/z$/, '');
    input[real](x, y);
    const settle = Number((config.load().memory || {}).actionSettleMs) || 1500;
    await new Promise((r) => setTimeout(r, settle));
    return '✅ 已点击（放大图坐标换算）：放大图(' + zx + ',' + zy + ') → 整屏(' + x + ',' + y + ')（已等 ' + (settle / 1000).toFixed(1) + 's）';
  }
  if (tool === 'drag') {
    /* 两种写法都收：
     *   drag|x1,y1|x2,y2   （提示词里的标准写法）
     *   drag|x1,y1,x2,y2   （模型很自然会写成四段逗号 —— 实测她就这么发过
     *                        "960,540,960,200"，被拒后白费一步）
     * 不能直接用 parseXY 切，那个函数要求整串恰好是一对坐标。 */
    const s = String(arg || '');
    let a, b;
    if (s.includes('|')) {
      const parts = s.split('|');
      a = parseXY(parts[0]); b = parseXY(parts[1]);
    } else {
      const all = s.split(/[,，]/).map((x) => Number(String(x).trim()));
      if (all.length !== 4 || all.some((n) => !Number.isFinite(n))) {
        throw new Error('拖拽格式应为 drag|x1,y1|x2,y2（也接受 x1,y1,x2,y2 四段写法），收到的是：' + s.slice(0, 40));
      }
      a = [all[0], all[1]]; b = [all[2], all[3]];
    }
    const [x1, y1] = a, [x2, y2] = b;   // drag 同样是整屏坐标（不换算，理由见上面 click 那段）
    input.drag(x1, y1, x2, y2);
    return `✅ 已拖拽：(${x1},${y1}) → (${x2},${y2})`;
  }
  if (tool === 'scroll') {
    const parts = String(arg).split('|').map((s) => s.trim());
    const [x, y] = parseXY(parts[0]);   // scroll 也是整屏坐标
    /* 支持三种写法，意思一样：
     *   scroll|x,y|down          向下滚一屏（默认 5 格 = 600）
     *   scroll|x,y|down|10       向下滚 10 格
     *   scroll|x,y|-600          直接给滚轮量（**正数 = 向上**，Windows 原生约定）
     *
     * 为什么要加 up/down 这种写法：原来只收裸数字，而"正数向上"和很多人的直觉
     * （网页里 scrollTop 正数是往下）**相反** —— 实测模型会搞反，用户就报了
     * "滚动工具反了，不能自由滚动"。用词表达方向就没有歧义了。
     * 另外原来默认只有 120（一格），一次滚一丁点，多步任务里光滚屏就把步数耗光，
     * 这也是"不能自由滚动"的来源。现在默认向下滚一屏，还可以一次给格数。 */
    const dirWord = String(parts[1] || '').toLowerCase();
    let delta;
    if (['up', 'down', '上', '下'].includes(dirWord)) {
      const n = Math.max(1, Math.min(20, Number(parts[2]) || 5));
      delta = (dirWord === 'up' || dirWord === '上' ? 1 : -1) * n * 120;
    } else {
      delta = Number(parts[1]) || 0;
      if (!delta) delta = -600;                     // 什么都不给 → 向下滚一屏
    }
    delta = Math.max(-6000, Math.min(6000, delta));  // 封顶，别一滚到底
    input.scroll(x, y, delta);
    const up = delta > 0;
    return `✅ 已滚动：(${x},${y}) 向${up ? '上' : '下'} ${Math.abs(delta) / 120} 格\n`
      + '（滚轮只会作用于**光标下/当前有焦点**的那个窗口。要是没反应：先确认目标窗口没被别的窗口'
      + '——**包括我自己的桌宠窗**——挡住，或者先点一下目标窗口的空白处让它获得焦点，然后再滚。）';
  }
  if (tool === 'focus_window') {
    /* 把目标窗口抬到最前。她自己反复被'游戏被别的窗口盖住'挡住（看不到就点不准），
       而 Windows 不允许后台进程改前台 —— 但 SetWindowPos(HWND_TOPMOST) 不需要那个权限，
       抬到最上面就够（截图和点击都是按最上面的窗口算的）。 */
    const r = await require('./focuswin').focusWindow(arg);
    if (r.startsWith('OK')) return '🪟 已把窗口抬到最前：' + r.slice(3) + '（现在截图/点击都以它为准）';
    if (r.startsWith('NOTFOUND')) return '🪟 没找到标题含「' + arg + '」的窗口。当前可见窗口：\n' + r.slice(8);
    return '🪟 ' + r;
  }
  if (tool === 'find_template_scroll') {
    /* 【滚动列表里找模板】模板匹配的三个天生短板之一：目标在列表里、当前屏看不到。
       做法（学 MaaAssistantArknights 的 Scroll + next 循环重扫）：
         把光标移到列表区域中心（滚轮只作用于光标下的窗口，不移动光标滚轮就打到别处）→
         抓帧找模板 → 没找到就滚一屏 → 再找 … → 找到为止或次数用尽。
       ⚠️ **找不到时必须滚回原位**：不能把界面留在被改动过的状态（否则她下一步看到的是一个
          和之前不一样的列表，会基于错误画面做判断）。
       用法：find_template_scroll|<模板名>|<列表区域 x,y,w,h>[|down|up][|最大次数] */
    const spS = String(arg || '').split('|').map((s) => s.trim());
    const nmS = spS[0] || '';
    const roiS = (spS[1] || '').split(/[,，]/).map((v) => Number(v.trim()));
    if (!nmS || roiS.length !== 4 || !roiS.every((v) => Number.isFinite(v))) {
      return '⚠️ 用法：find_template_scroll|<模板名>|<列表区域 x,y,w,h>[|down|up][|最大次数]';
    }
    const dirS = (spS[2] || 'down').toLowerCase().startsWith('u') ? 'up' : 'down';
    const timesS = Math.max(1, Math.min(12, Number(spS[3]) || 5));
    const [rxS, ryS, rwS, rhS] = roiS;
    const cxS = Math.round(rxS + rwS / 2), cyS = Math.round(ryS + rhS / 2);
    const { nativeImage } = require('electron');
    const MS = require('./matcher');
    input.move(cxS, cyS);                       // 光标必须先落在列表上（滚轮作用于光标下的窗口）
    await new Promise((r) => setTimeout(r, 220));
    let scrolledS = 0;
    let lastS = null;
    for (let k = 0; k <= timesS; k++) {
      const capS = await captureScreen(false, true);
      lastS = await MS.findTemplate(app, nativeImage, nmS, capS.dataUrl, [rxS, ryS, rwS, rhS]);
      if (lastS.ok) {
        return '🎯 找到「' + nmS + '」：中心 (' + lastS.x + ',' + lastS.y + ')，相似度 ' + lastS.score.toFixed(3)
          + '（滚了 ' + scrolledS + ' 屏' + (lastS.ms != null ? '，本次匹配 ' + lastS.ms + 'ms' : '') + '）。'
          + '现在可以直接 ACTION: click|' + lastS.x + ',' + lastS.y + '。';
      }
      if (!lastS.low && !lastS.ok) return '⚠️ ' + (lastS.error || '匹配失败');
      if (k === timesS) break;
      await userinput.waitUntilFree(30000);      // 主人一动就等，和别的键鼠操作一致
      input.scroll(cxS, cyS, dirS === 'up' ? 'up' : 'down');
      scrolledS++;
      await new Promise((r) => setTimeout(r, 420));   // 等滚动动画结束
    }
    /* 没找到 → 滚回原位，别把界面留在改动过的状态 */
    for (let k = 0; k < scrolledS; k++) {
      input.scroll(cxS, cyS, dirS === 'up' ? 'down' : 'up');
      await new Promise((r) => setTimeout(r, 260));
    }
    return '⚠️ 在这个列表里滚了 ' + scrolledS + ' 屏也没找到「' + nmS + '」'
      + '（最佳相似度只有 ' + (lastS && lastS.score != null ? lastS.score.toFixed(2) : '?') + '，低于阈值 0.70）。'
      + '**我已经把列表滚回原来的位置了**，界面和你交给我时一样。'
      + '可能原因：模板截自别的皮肤/缩放比例，或者这个列表里确实没有它 —— 先用 screen_look 或 find_text 确认。';
  }
  if (tool === 'find_text') {
    /* 【文字的模板匹配】OCR 当前画面，找出那段文字在哪，返回中心坐标。
       用途：游戏里大量目标只有文字没有图标 —— 干员名、设施名、列表项、按钮上的字。
       （模板匹配 find_template 认图不认字，正好互补。）
       用法：find_text|要找的文字       或   find_text|要找的文字| x,y,w,h（只在这块区域里找）
       找不到时会把**整屏 OCR 到的文字**列给她 —— 这样她能看到屏幕上真实写了什么，
       而不是继续瞎猜（今天反复出现"她以为界面上有某个词、其实没有"）。 */
    const sp0 = String(arg || '').split('|').map((s) => s.trim());
    const needle = sp0[0] || '';
    if (!needle) return '⚠️ 用法：find_text|要找的文字';
    const cap4 = await captureScreenFallback();     // OCR 用无损 PNG（比 JPEG 帧更利于小字识别）
    const j = await ocrJson(cap4.path);
    if (!j) return '⚠️ OCR 没有返回结果（可能没有中文识别包，或这一步超时了）。可以改用 find_template 找图标，或 screen_look 自己看。';
    let hit = findTextInOcr(j, needle);
    /* 可选：限定区域（先整体命中再用区域过滤，避免"区域外有同名文字"干扰） */
    if (hit && sp0[1]) {
      const n = sp0[1].split(/[,，]/).map((v) => Number(v.trim()));
      if (n.length === 4 && n.every((v) => Number.isFinite(v))) {
        const inRoi = hit.x >= n[0] && hit.x <= n[0] + n[2] && hit.y >= n[1] && hit.y <= n[1] + n[3];
        if (!inRoi) hit = null;
      }
    }
    if (hit) {
      return '🔤 找到「' + needle + '」：中心 (' + hit.x + ',' + hit.y + ')，它所在的那一行是「' + hit.line
        + '」。现在可以直接 ACTION: click|' + hit.x + ',' + hit.y + '。';
    }
    const onScreen = ((j.lines || []).map((l) => String(l.text || '').replace(/\s+/g, '')).filter(Boolean)).slice(0, 12);
    return '⚠️ 当前画面上没找到「' + needle + '」。OCR 实际读到的文字是：\n'
      + (onScreen.length ? onScreen.map((t) => '- ' + t).join('\n') : '（这一屏没识别到任何文字）')
      + '\n请照这个真实结果判断：也许这一屏确实没有这个词，或者需要先切到另一屏 / 往下滚。';
  }
  if (tool === 'make_template') {
    /* 从**当前画面**裁一块存成模板（存 PNG 给人看 + 原始 BGRA 给 match.exe 用）。
       用法：make_template|按钮名| x,y,w,h
       为什么要这个工具：模板匹配的前提是"有模板"。与其由我在开发期预先截一堆游戏按钮，
       不如让她在**真正看到那个按钮的那一刻**自己裁下来 —— 下次再遇到同一个按钮就能精确定位。
       抓帧用 noCursor（不画准星）：光标压在按钮上会污染模板。 */
    const mm = String(arg || '').match(/^\s*([^|]+?)\s*\|\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/);
    if (!mm) return '⚠️ 用法：make_template|模板名| x,y,w,h（x,y,w,h 是屏幕上那块区域的坐标，用 screen_look 看准了再裁）';
    const { nativeImage } = require('electron');
    const cap2 = await captureScreen(false, true);
    const got = require('./matcher').saveTemplate(app, nativeImage, mm[1],
      cap2.dataUrl, { x: Number(mm[2]), y: Number(mm[3]), w: Number(mm[4]), h: Number(mm[5]) });
    if (!got.ok) return '⚠️ 存模板失败：' + got.error;
    const all = require('./matcher').listTemplates(app);
    return '✅ 已存模板「' + got.name + '」（' + got.w + 'x' + got.h + '），现在一共 ' + all.length + ' 个模板。'
      + '以后用 find_template|' + got.name + ' 就能在当前画面里精确定位它（返回坐标可直接 click）。';
  }
  if (tool === 'find_template') {
    /* 在**当前画面**里精确找模板，返回匹配框中心（截图空间坐标，可直接给 click）。
       这是这套改造的核心：把"她估计坐标"换成"确定性找图"。
       用法：find_template|模板名        或   find_template|模板名| x,y,w,h（限定搜索区域，快很多） */
    const sp = String(arg || '').split('|').map((s) => s.trim());
    const nm = sp[0] || '';
    let roi = null;
    if (sp[1]) {
      const n = sp[1].split(/[,，]/).map((v) => Number(v.trim()));
      if (n.length === 4 && n.every((v) => Number.isFinite(v))) roi = n;
    }
    const { nativeImage } = require('electron');
    const cap3 = await captureScreen(false, true);
    /* 级联多尺度：先按 1.0 找（快路径），分数低才依次试 0.9/1.1/0.8/1.25 ——
       治"用户改了系统缩放 / 模板截自别的尺寸"这个天生短板。 */
    const r3 = await require('./matcher').findTemplateScaled(app, nativeImage, nm, cap3.dataUrl, roi);
    if (!r3.ok && !r3.low) return '⚠️ ' + (r3.error || '匹配失败，原因未知');
    if (r3.low) {
      return '⚠️ 没找到「' + nm + '」（最佳分数只有 ' + r3.score.toFixed(2) + '，低于阈值 0.70）。'
        + '可能这一屏根本没这个按钮，或者你的模板是别的分辨率/皮肤下截的。'
        + '建议先用 screen_look 看一眼当前在哪一屏，确认那个按钮在不在。';
    }
    return '🎯 找到「' + nm + '」：中心 (' + r3.x + ',' + r3.y + ')，匹配框 ' + r3.w + 'x' + r3.h
      + '，相似度 ' + r3.score.toFixed(3) + '（' + r3.ms + 'ms）。'
      + '现在可以直接 ACTION: click|' + r3.x + ',' + r3.y + '（坐标就是截图空间，和 screen_look 一致）。';
  }
  if (tool === 'template_list' || tool === 'template_del') {
    const M2 = require('./matcher');
    if (tool === 'template_list') {
      const all = M2.listTemplates(app);
      if (!all.length) return '📦 还没有任何模板。用 make_template|名字| x,y,w,h 从当前画面裁一个。';
      return '📦 已有 ' + all.length + ' 个模板：\n' + all.map((t) => '- ' + t.name + '（' + t.w + 'x' + t.h + '）').join('\n');
    }
    const n2 = M2.delTemplate(app, String(arg || '').trim());
    return n2 ? '🗑 已删除模板「' + String(arg).trim() + '」' : '⚠️ 没有这个模板';
  }
  if (tool === 'windows_list') {
    /* 列出可见窗口（标题+位置尺寸，**换算成截图空间的像素**）。
       抄自参考项目 Coopanion 的 cua_windows：给模型一条"结构化通道"，
       这样"哪个窗口在哪、该切哪个"就不必靠模型猜坐标。
       ⚠️ 坐标换算：跑 PowerShell 的子进程不是 DPI-aware，Windows 给它的是虚拟化坐标
       （物理 ÷ scaleFactor），而截图空间是物理像素 —— 所以用"截图宽 ÷ DIP 宽"这个比值乘回去。
       本机实测 1920/1536 = 1.25；不乘的话她会按偏小 25% 的坐标去点。 */
    const rows = await require('./focuswin').listWindows();
    if (!rows.length) return '🪟 没读到任何可见窗口（可能被权限挡了）。';
    let capK = 1;
    try {
      const { screen } = require('electron');
      const d = screen.getPrimaryDisplay();
      const s = require('./input').space();
      if (d && d.size && d.size.width) capK = s.w / d.size.width;
    } catch {}
    const lines = rows.slice(0, 30).map((r) => '- 「' + r.title + '」 左上('
      + Math.round(r.x * capK) + ',' + Math.round(r.y * capK) + ') 大小 '
      + Math.round(r.w * capK) + 'x' + Math.round(r.h * capK));
    return '🪟 当前可见窗口（坐标已换算成截图空间，可以直接用来 click/focus_window）：\n' + lines.join('\n');
  }
  if (tool === 'type') {
    /* 【分段可中断输入】抄自参考项目 Coopanion（packages/cortico-world-cua/src/engine-child.ts:113-126）：
       长文本按 16 字符一段发，**每段之间再查一次主人是否在用键鼠**，他一动就停手，
       并**如实回报实际打出了几个字符**（它的 cua_type 回执就写"只输入了 x/y 个字符：
       用户开始操作，停了下来"）。原来是一次性把整段发进 Input.exe —— 主人中途接手时
       她的输入会继续灌进去，把人正在打的字搅乱。 */
    const text = String(arg);
    const CHUNK = 16;
    let done = 0;
    try {
      const ui = require('./userinput');
      for (let i = 0; i < text.length; i += CHUNK) {
        if (done > 0 && ui.isUserActive()) break;      // 主人开始操作 → 立刻停手
        const part = text.slice(i, i + CHUNK);
        input.type(part);
        done += part.length;
        if (i + CHUNK < text.length) await new Promise((r) => setTimeout(r, 60));
      }
    } catch (e) {
      if (!done) { input.type(text); done = text.length; }
    }
    /* 同上：输入会改变界面，等它反应完再让她看屏幕 */
    const settle = Number((config.load().memory || {}).actionSettleMs) || 1500;
    await new Promise((r) => setTimeout(r, settle));
    if (done < text.length) {
      return `⚠️ 只输入了 ${done}/${text.length} 个字符：**主人开始操作了，我停下来了**。`
        + `已经打进去的是：「${text.slice(0, done)}」；还没打的是：「${text.slice(done, done + 30)}${text.length - done > 30 ? '…' : ''}」。`
        + `主人松手后可以让我接着输入剩下的部分。`;
    }
    return `✅ 已输入文字：${text.slice(0, 50)}（已等 ${(settle / 1000).toFixed(1)}s）`;
  }
  if (tool === 'key') {
    input.key(arg);
    /* 按键（回车/ESC/方向键）常常触发界面跳转（比如登录、确认对话框），同样要等 */
    const settle = Number((config.load().memory || {}).actionSettleMs) || 1500;
    await new Promise((r) => setTimeout(r, settle));
    return `✅ 已按键：${arg}（已等 ${(settle / 1000).toFixed(1)}s）`;
  }
}

/* __captureForTest / __captureFallbackForTest：只给测试脚本用（抓帧链路 + 无光标选项）。
   带下划线前缀表示"不是给模型调用的工具"，不进 TOOL_TIER、不进工具清单。 */
module.exports = {
  run, allowed, TOOL_TIER, RANK,
  __captureForTest: (grid, noCursor) => captureScreen(grid, noCursor),
  __captureFallbackForTest: () => captureScreenFallback(),
  __findTextInOcr: (j, needle) => findTextInOcr(j, needle),
  __ocrJson: (p) => ocrJson(p),
};
