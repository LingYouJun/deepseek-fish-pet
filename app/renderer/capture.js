/* 隐藏窗口里的屏幕捕获页：主进程用 executeJavaScript 驱动它
 *   __startStream(sourceId) -> 拉桌面视频流，等第一帧可画
 *   __grabFrame()           -> 把当前帧画进 canvas 返回 jpeg dataURL
 */
let stream = null, video = null, canvas = null, ctx = null;

window.__startStream = async (sourceId) => {
  if (stream && ctx) return { ok: true, w: canvas.width, h: canvas.height };
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30,
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
  // 缩到 720p：够看够 OCR，JPEG 编码快一截，抓帧更省
  canvas.width = 1280;
  canvas.height = 720;
  ctx = canvas.getContext('2d');
  return { ok: true, w: canvas.width, h: canvas.height };
};

window.__grabFrame = () => {
  if (!ctx || !video) return null;
  ctx.drawImage(video, 0, 0, 1280, 720);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.75), width: 1280, height: 720 };
};
