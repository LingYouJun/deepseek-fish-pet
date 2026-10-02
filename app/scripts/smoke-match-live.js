/* 真屏幕冒烟测试：验证 captureScreen(noCursor) + toBitmap() 这条真实链路，
 * 并**用数据回答**调研里那句"模板匹配别用 JPEG"到底影响多大。
 *
 * 做法：抓一帧真实屏幕 → 从里面挑一块"有纹理"的区域当模板（自动挑方差最大的块，
 * 避开桌面上的纯色区域，纯色模板匹配没有意义）→ 分别用 JPEG 帧和 PNG 帧去匹配同一个模板，
 * 比较分数与耗时。两者坐标系都是截图空间（1920x1080）。
 *
 * 跑法：electron.exe app\scripts\smoke-match-live.js
 */
const path = require('path');
const fs = require('fs');
const { app, nativeImage } = require('electron');

const T = path.join(process.env.APPDATA, 'dayu-pet-matchsmoke');
fs.mkdirSync(T, { recursive: true });
app.setPath('userData', T);
require('../main.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const M = require('../src/matcher');
  const assistant = require('../src/assistant');
  console.log('=== 真屏幕冒烟测试 ===');
  await sleep(5000);

  /* 1) 无光标抓帧（JPEG 流）+ 原始 BGRA */
  const jpg = await assistant.__captureForTest(false, true).catch(() => null);
  if (!jpg) { console.log('  ❌ 抓帧失败（captureScreen 不可用）'); return setTimeout(() => app.exit(1), 200); }
  const W = jpg.width, H = jpg.height;
  console.log('  · JPEG 帧（无光标）: ' + W + 'x' + H + '  ' + Math.round(jpg.dataUrl.length / 1024) + 'KB');
  const bmp = M.toBgra(nativeImage, jpg.dataUrl);
  console.log('  · toBitmap() 得到原始 BGRA: ' + bmp.w + 'x' + bmp.h + '  ' + bmp.buf.length + ' 字节  （期望 ' + (W * H * 4) + '）');
  console.log('    ' + (bmp.buf.length === W * H * 4 ? '✅ 尺寸吻合' : '❌ 尺寸不符'));

  /* 2) 自动挑一块有纹理的区域当模板（方差最大） */
  const TW = 96, TH = 72, STEP = 160;
  const findTextured = (buf, w, h) => {
    let best = { v: -1, x: 0, y: 0 };
    const gray = (p) => (buf[p + 2] * 77 + buf[p + 1] * 150 + buf[p] * 29) >> 8;
    for (let y = 0; y + TH < h; y += STEP) {
      for (let x = 0; x + TW < w; x += STEP) {
        let s = 0, s2 = 0, n = 0;
        for (let yy = 0; yy < TH; yy += 4) {
          for (let xx = 0; xx < TW; xx += 4) {
            const g = gray(((y + yy) * w + (x + xx)) * 4);
            s += g; s2 += g * g; n++;
          }
        }
        const mean = s / n;
        const va = s2 / n - mean * mean;
        if (va > best.v) best = { v: va, x, y };
      }
    }
    return best;
  };
  const spot = findTextured(bmp.buf, W, H);
  console.log('  · 自动挑到纹理最丰富的区域: (' + spot.x + ',' + spot.y + ') 方差=' + Math.round(spot.v));
  if (spot.v < 50) { console.log('  ⚠️ 屏幕太"平"了（方差 ' + Math.round(spot.v) + '）—— 桌面大多是纯色，这个测试说服力有限，但流程仍然验证了'); }

  /* 3) 用 JPEG 帧裁模板，再分别用 JPEG 帧 / PNG 帧去找 */
  const sv = M.saveTemplate(app, nativeImage, 'live', jpg.dataUrl, { x: spot.x, y: spot.y, w: TW, h: TH });
  console.log('  · 存模板: ' + (sv.ok ? sv.name + ' ' + sv.w + 'x' + sv.h : sv.error));
  if (!sv.ok) return setTimeout(() => app.exit(1), 200);

  const rJpg = await M.findTemplate(app, nativeImage, 'live', jpg.dataUrl);
  console.log('  · 用 **JPEG 帧** 找: ' + (rJpg.ok || rJpg.low ? 'score=' + rJpg.score.toFixed(4) + '  坐标(' + rJpg.x + ',' + rJpg.y + ')  ' + rJpg.ms + 'ms' : 'ERR ' + rJpg.error));
  const expX = spot.x + TW / 2, expY = spot.y + TH / 2;
  console.log('    期望中心 = (' + expX + ',' + expY + ')  → ' + (Math.abs(rJpg.x - expX) <= 1 && Math.abs(rJpg.y - expY) <= 1 ? '✅ 精确吻合' : '❌ 偏了'));

  /* 4) PNG 帧（无损，慢）对比 */
  let png = null;
  try { png = await assistant.__captureFallbackForTest(); } catch (e) { console.log('  · PNG 抓帧失败: ' + e.message); }
  if (png) {
    console.log('  · PNG 帧: ' + png.width + 'x' + png.height + '  ' + Math.round(png.dataUrl.length / 1024) + 'KB');
    const rPng = await M.findTemplate(app, nativeImage, 'live', png.dataUrl);
    console.log('  · 用 **PNG 帧** 找: ' + (rPng.ok || rPng.low ? 'score=' + rPng.score.toFixed(4) + '  坐标(' + rPng.x + ',' + rPng.y + ')  ' + rPng.ms + 'ms' : 'ERR ' + rPng.error));
    if (rJpg.score != null && rPng.score != null) {
      const d = (rPng.score - rJpg.score);
      console.log('    → PNG 比 JPEG 分数高 ' + d.toFixed(4) + (d > 0.02 ? '（说明调研那句"别用 JPEG"确实有影响，值得为模板用 PNG）' : '（差别很小，JPEG 流够用，可以省掉慢速 PNG 抓帧）'));
    }
  }

  const all = M.listTemplates(app);
  console.log('  · 模板目录现在有 ' + all.length + ' 个模板');
  console.log('');
  console.log('冒烟测试结束');
  setTimeout(() => app.exit(0), 300);
});
