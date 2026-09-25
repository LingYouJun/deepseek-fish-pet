// 连续屏幕流（MediaProjection）—— 实时屏幕感知的底座。
//
// 为什么不用 desktopCapturer.getSources 直接截图：
//   实测每次调用 ~650ms（枚举源 + 抓帧 + PNG 编码），而且缩小分辨率也救不了，
//   那个开销是 API 本身固定的。对"实时看屏幕"完全不够。
//
// 这里改成：一个隐藏窗口里用 getUserMedia(chromeMediaSource:'desktop') 拉起
// 一条 30fps 的屏幕视频流，抓一帧只要几十毫秒。grabFrame() 按需取当前帧，
// watch(fps) 供以后"持续盯屏幕"的功能按固定频率取帧。
//
// 失败时 grabFrame() 返回 null，调用方退回 desktopCapturer 慢速截图。
const { BrowserWindow, desktopCapturer, screen } = require('electron');
const path = require('path');

let win = null;
let ready = false;
let starting = null;
let failed = false;   // 流方式起不来，之后一直走回退

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    show: false,
    width: 640, height: 360,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'capture.html'));
  win.on('closed', () => { win = null; ready = false; });
  return win;
}

async function init() {
  if (ready || failed) return;
  if (starting) return starting;
  starting = (async () => {
    try {
      const w = ensureWindow();
      if (w.webContents.isLoading()) await new Promise((r) => w.webContents.once('did-finish-load', r));
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 2, height: 2 } });
      const primary = screen.getPrimaryDisplay();
      const src = sources.find((s) => s.display_id === String(primary.id)) || sources[0];
      if (!src) throw new Error('no screen source');
      await w.webContents.executeJavaScript(`window.__startStream(${JSON.stringify(src.id)})`);
      ready = true;
    } catch (e) {
      failed = true;
    }
  })().finally(() => { starting = null; });
  return starting;
}

/* 抓当前帧。返回 { dataUrl(jpeg), width, height }；流不可用返回 null */
async function grabFrame() {
  await init();
  if (!ready) return null;
  try {
    const w = ensureWindow();
    return await w.webContents.executeJavaScript('window.__grabFrame()');
  } catch { return null; }
}

/* 连续取帧：每 1000/fps 毫秒抓一帧回调（封底 5fps，别把机器拖垮） */
function watch(fps, onFrame) {
  const iv = setInterval(async () => {
    try {
      const f = await grabFrame();
      if (f) onFrame(f);
    } catch {}
  }, Math.max(200, Math.round(1000 / fps)));
  return () => clearInterval(iv);
}

module.exports = { grabFrame, watch, warm: init };
