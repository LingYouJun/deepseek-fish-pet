/* 模板匹配：让"她要点哪一个按钮"这件事从"模型估计坐标"变成"确定性找图"
 *
 * 【为什么要做这件事 —— 今天的实测数据】
 *   抓帧确实是 1920x1080（= 物理屏 1:1，207 万像素，不可能更高），坐标链路误差 0~1px
 *   （用 GetCursorPos 验证过）。但**让视觉大模型直接输出像素坐标**，同一个按钮每次读数差 20~120px，
 *   密集 UI（游戏里的小页签、干员卡片）根本点不中；把区域裁出来放大 3 倍仍然飘。
 *   调研结论：这不是分辨率问题、也不是提示词问题，是**方法**问题 ——
 *     ScreenSpot-Pro 上最好的模型只有 18.9%；换成"先枚举候选、再让模型选序号"（OmniParser）能到 73%；
 *     SeeAct 明确指出 grounding（定位）就是瓶颈。
 *   游戏自动化领域（MaaAssistantArknights 等）的做法是**模板匹配**：
 *     把按钮的小图存下来，在全屏图里找相关性最高的位置 → 像素级精确、而且**确定性**（同画面必然同结果）。
 *
 * 【分工】
 *   她（LLM）：看画面、判断"现在哪个界面、该点哪个语义目标" —— 这是她的强项，今天已反复证明。
 *   本模块（CV）：在指定区域里把那个目标**精确**找出来，返回坐标。
 *
 * 【实现】
 *   app/vendor/match/Match.cs 编译成 match.exe：灰度 + 零均值归一化相关（TM_CCOEFF_NORMED 同款），
 *   半分辨率隔点粗搜 + 原始分辨率精修（全屏实测 238ms、限定 ROI 19ms）。
 *   本模块负责：从抓帧里拿原始 BGRA（Electron nativeImage.toBitmap，不做 JPEG 解码）、
 *   存/取模板、调 match.exe、把结果换算成**截图空间坐标**（和 click 用的同一套坐标）。
 *
 * ⚠️ 模板与搜索帧必须同尺度。我们的抓帧恒定 1920x1080（DPI 缩放也恒定），所以不需要多尺度匹配
 *    —— 这也正是 MAA 的做法：每次截图统一缩放到固定基准后再匹配。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const EXE = path.join(__dirname, '..', 'vendor', 'match', 'match.exe');

function tplDir(app) {
  const d = path.join(app.getPath('userData'), 'templates');
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

/* dataURL -> { buf: BGRA Buffer, w, h }
   ⚠️ 通道顺序：Electron 的 toBitmap() 在 Windows 上是 BGRA。就算某个平台是 RGBA 也没关系 ——
   模板与搜索帧走的是同一条路径，灰度权重一致，匹配结果不受影响。 */
function toBgra(nativeImage, dataUrl) {
  const img = nativeImage.createFromDataURL(dataUrl);
  const s = img.getSize();
  return { buf: img.toBitmap(), w: s.width, h: s.height };
}

function safeName(n) {
  const s = String(n || '').trim().replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 60);
  return s || '';
}

/* 存模板：同时存 PNG（给人看/便于检查）与 .bin（给 match.exe 读的原始 BGRA） */
function saveTemplate(app, nativeImage, name, dataUrl, rect) {
  const nm = safeName(name);
  if (!nm) return { ok: false, error: '模板名不能为空' };
  const img = nativeImage.createFromDataURL(dataUrl).crop({ x: rect.x, y: rect.y, width: rect.w, height: rect.h });
  const s = img.getSize();
  if (s.width < 8 || s.height < 8) return { ok: false, error: '模板太小（至少 8x8）：' + s.width + 'x' + s.height };
  const dir = tplDir(app);
  const png = path.join(dir, nm + '.png');
  const bin = path.join(dir, nm + '.bin');
  fs.writeFileSync(png, img.toPNG());
  const bmp = img.toBitmap();
  fs.writeFileSync(bin, bmp);
  fs.writeFileSync(bin + '.meta.json', JSON.stringify({ name: nm, w: s.width, h: s.height, at: Date.now() }));
  return { ok: true, name: nm, w: s.width, h: s.height, png, bin };
}

function listTemplates(app) {
  const dir = tplDir(app);
  try {
    const metas = fs.readdirSync(dir).filter((f) => f.endsWith('.bin.meta.json'));
    const out = [];
    for (const m of metas) {
      try { const j = JSON.parse(fs.readFileSync(path.join(dir, m), 'utf8')); out.push(j); } catch {}
    }
    return out;
  } catch { return []; }
}

function delTemplate(app, name) {
  const nm = safeName(name);
  const dir = tplDir(app);
  let n = 0;
  for (const ext of ['.png', '.bin', '.bin.meta.json']) {
    const p = path.join(dir, nm + ext);
    try { if (fs.existsSync(p)) { fs.unlinkSync(p); n++; } } catch {}
  }
  return n;
}

/* 在 frameDataUrl 里找 name 模板。roi 可选：[x,y,w,h]（截图空间）。
   返回 { ok, score, x, y, w, h, ms } 或 { ok:false, error } */
function findTemplate(app, nativeImage, name, frameDataUrl, roi, minScore) {
  return new Promise((resolve) => {
    const nm = safeName(name);
    const dir = tplDir(app);
    const bin = path.join(dir, nm + '.bin');
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(bin + '.meta.json', 'utf8')); } catch {}
    if (!meta || !fs.existsSync(bin)) return resolve({ ok: false, error: '没有名为「' + nm + '」的模板（先用 make_template 建一个）' });
    if (!fs.existsSync(EXE)) return resolve({ ok: false, error: 'match.exe 不存在（需要编译 vendor/match/Match.cs）' });
    let fr;
    try { fr = toBgra(nativeImage, frameDataUrl); } catch (e) { return resolve({ ok: false, error: '解码当前帧失败：' + e.message }); }
    const tmpF = path.join(os.tmpdir(), 'match-frame-' + process.pid + '-' + Date.now() + '.bin');
    try { fs.writeFileSync(tmpF, fr.buf); } catch (e) { return resolve({ ok: false, error: '写临时帧失败：' + e.message }); }
    const args = [tmpF, String(fr.w), String(fr.h), bin, String(meta.w), String(meta.h)];
    if (roi && roi.length === 4) args.push(String(roi[0]), String(roi[1]), String(roi[2]), String(roi[3]));
    if (minScore != null) {
      if (!roi || roi.length !== 4) args.push('0', '0', String(fr.w), String(fr.h));
      args.push(String(minScore));
    }
    execFile(EXE, args, { timeout: 30000, windowsHide: true }, (e, so) => {
      try { fs.unlinkSync(tmpF); } catch {}
      const out = String(so || '').trim();
      const m = out.match(/^(OK|LOW|ERR)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+ms=(\d+))?/);
      if (!m) return resolve({ ok: false, error: 'match.exe 输出无法解析：' + (out || (e && e.message) || '') });
      if (m[1] === 'ERR') return resolve({ ok: false, error: 'match.exe: ' + out });
      return resolve({
        ok: m[1] === 'OK', low: m[1] === 'LOW', score: Number(m[2]),
        x: Number(m[3]), y: Number(m[4]), w: Number(m[5]), h: Number(m[6]),
        ms: m[7] ? Number(m[7]) : null, frameW: fr.w, frameH: fr.h,
      });
    });
  });
}

module.exports = { saveTemplate, findTemplate, listTemplates, delTemplate, toBgra, EXE, tplDir };
