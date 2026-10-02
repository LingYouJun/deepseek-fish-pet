/* 隐藏窗口里的屏幕捕获页：主进程用 executeJavaScript 驱动它
 *   __startStream(sourceId, w, h) -> 拉桌面视频流，等第一帧可画
 *   __grabFrame()                 -> 把当前帧画进 canvas 返回 jpeg dataURL
 *
 * ⚠️ 分辨率由主进程传进来（config.screenCaptureWidth/Height），**不要在这里写死**。
 *    原来写死 1280x720，用户反馈"分辨率太低、桌宠分辨不了了"：
 *    1920 的屏幕压到 1280 再被视觉 API 的 detail:low 压一次，小字图标全糊。
 *    注意：抓帧尺寸同时是**坐标空间**（模型报的 x,y 就基于这个尺寸），
 *    所以改尺寸必须让 input.norm / 提示词一起跟着改，否则点击会错位。 */
let stream = null, video = null, canvas = null, ctx = null;
let CAP_W = 1920, CAP_H = 1080, JPEG_Q = 0.92;

window.__startStream = async (sourceId, w, h, q) => {
  if (w > 0) CAP_W = Math.round(w);
  if (h > 0) CAP_H = Math.round(h);
  if (q > 0) JPEG_Q = Math.min(1, Math.max(0.3, Number(q)));
  if (stream && ctx) return { ok: true, w: canvas.width, h: canvas.height };
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30,
      },
    },
  };
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  video.srcObject = stream;
  document.body.appendChild(video);
  await video.play();
  // 等视频真正有可画的帧（readyState >= HAVE_CURRENT_DATA）
  for (let i = 0; i < 40 && video.readyState < 2; i++) await new Promise((r) => setTimeout(r, 50));
  canvas = document.createElement('canvas');
  canvas.width = CAP_W;
  canvas.height = CAP_H;
  ctx = canvas.getContext('2d');
  return { ok: true, w: canvas.width, h: canvas.height };
};

/* 画面指纹：把当前帧缩成 64x36 灰度格（2304 格，每格约 20x20 像素），主进程用它判断"画面到底变没变"。
   两个坑都实测过：
   1) 必须在**像素**上算，不能对 jpeg 字节做哈希 —— 同一静止画面两次编码的字节并不相同
      （实测 91043 / 91347），按字节采样会错位雪崩，把"没变"误判成 89% 巨变。
   2) 网格不能太粗 —— 16x9 时"白底上又开一个白窗口"整屏 0 格变化，完全看不见；
      48x27 才看得出来（静止时单格最大差 7，真变化时 40+）。 */
const FP_W = 64, FP_H = 36;
let fpCanvas = null, fpCtx = null;
function frameSig() {
  if (!ctx || !video) return '';
  if (!fpCanvas) {
    fpCanvas = document.createElement('canvas');
    fpCanvas.width = FP_W; fpCanvas.height = FP_H;
    fpCtx = fpCanvas.getContext('2d', { willReadFrequently: true });
  }
  fpCtx.drawImage(video, 0, 0, FP_W, FP_H);
  const d = fpCtx.getImageData(0, 0, FP_W, FP_H).data;
  let out = '';
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    out += g.toString(16).padStart(2, '0');
  }
  return out;
}

/* 抓帧。cursor 是主进程读到的光标位置（已经是这个抓帧空间的坐标），传进来就画在图上。
 *
 * ⚠️ 为什么要自己画光标：Electron 的桌面捕获（getUserMedia chromeMediaSource=desktop）
 * **不会把鼠标指针画进画面** —— 主进程日志里那条
 *   mouse_cursor_monitor_win.cc: Unable to get cursor info. Error = 5
 * 就是 Chromium 在尝试合成指针并被系统拒绝（Access Denied）。
 * 于是模型看到的截图里**没有光标**，它没法判断"鼠标现在在哪"，用户就报了
 * "她识别光标总是有问题"。而 screen.getCursorScreenPoint() 是读得到的 ——
 * 也就是说我们知道它在哪，只是没画出来。这里补上。
 *
 * 画法用"白底 + 黑边 + 十字"：任何背景色上都看得清，且不遮挡周围内容太多。 */
window.__grabFrame = (cursorX, cursorY) => {
  if (!ctx || !video) return null;
  ctx.drawImage(video, 0, 0, CAP_W, CAP_H);
  if (Number.isFinite(cursorX) && Number.isFinite(cursorY)) {
    const x = Math.max(0, Math.min(CAP_W - 1, cursorX));
    const y = Math.max(0, Math.min(CAP_H - 1, cursorY));
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 22, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 22, y);
    ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 22); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 22, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 22, y);
    ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 22); ctx.stroke();
    /* 中心一个小实心点，标出精确落点 */
    ctx.fillStyle = 'rgba(255,60,60,0.95)';
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_Q), width: CAP_W, height: CAP_H, sig: frameSig(), cursor: { x: cursorX, y: cursorY } };
};
