// 游戏助手：持续盯屏 → 视觉决策 → 键鼠执行 → 容错，循环到 DONE / 手动停止 / 到步数上限。
//
// 设计要点：
// - 循环在**主进程**里跑，不经过渲染层往返，一步就是「抓帧 → 视觉 → 解析动作 → 执行」。
// - 每步把「看到了什么 / 打算做什么 / 做了什么」通过 onLog 推给对话窗，用户能实时看到、
//   也能随时点停止（stopFlag 每步都会检查）。
// - 视觉模型按固定协议回答：先一句中文判断，最后一行要么 `ACTION: 工具|参数` 要么 `DONE`。
// - dryRun（试运行）：只观察和决策，不真的操作——先看它想干什么再决定要不要放它动手。
const screenstream = require('./screenstream');
const vision = require('./vision');
const assistant = require('./assistant');
const config = require('./config');

const PROTOCOL = '\n\n【协议】每次观察后：先用一句中文说明当前局面和你的判断；然后最后单独一行二选一——\n'
  + '- 需要操作：ACTION: 工具|参数（坐标基于 1280x720 截图，左上角 0,0，取你要点的元素中心）\n'
  + '- 已完成或没有可做的：DONE\n'
  + '可用工具：click / dclick / rclick / drag / scroll / type / key / move。';

let onLog = () => {};
let onStop = () => {};
let running = false;
let stopFlag = false;
let step = 0;
let opts = { task: '', intervalMs: 4000, maxSteps: 30, dryRun: false };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(kind, text) { try { onLog({ kind, text: String(text), step, at: Date.now() }); } catch {} }

function init(o) {
  if (o && o.onLog) onLog = o.onLog;
  if (o && o.onStop) onStop = o.onStop;
}
function status() { return { running, step, task: opts.task, dryRun: opts.dryRun, maxSteps: opts.maxSteps }; }

async function start(o) {
  if (running) return { ok: false, error: '游戏助手已经在跑了' };
  const cfg = config.load();
  const task = String((o && o.task) || '').trim();
  if (!task) return { ok: false, error: '请先写清楚要做什么（任务 / 策略）' };
  if (!cfg.visionEnabled) return { ok: false, error: '游戏助手需要视觉模型：请先在设置（⚙️）里勾选「启用视觉模型看画面」' };
  if (!assistant.allowed(cfg.assistant, 'click')) return { ok: false, error: '需要把 AI 助手权限开到「完全权限」（游戏助手要操作鼠标）' };
  opts = {
    task,
    intervalMs: Math.max(1200, Number((o && o.intervalMs) || 4000)),
    maxSteps: Math.max(1, Math.min(200, Number((o && o.maxSteps) || 30))),
    dryRun: !!(o && o.dryRun),
  };
  running = true; stopFlag = false; step = 0;
  log('info', '🎮 启动（间隔 ' + (opts.intervalMs / 1000) + 's，最多 ' + opts.maxSteps + ' 步）'
    + (opts.dryRun ? '【试运行：只看不动手】' : ''));
  log('info', '任务：' + task.slice(0, 120));
  loop().catch((e) => log('err', '循环异常：' + ((e && e.message) || e))).finally(() => {
    running = false;
    log('info', '🛑 游戏助手已停止（共 ' + step + ' 步）');
    try { onStop(); } catch {}
  });
  return { ok: true };
}

function stop() {
  if (!running) return { ok: true, already: true };
  stopFlag = true;
  log('info', '收到停止指令，正在收尾…');
  return { ok: true };
}

async function loop() {
  while (running && !stopFlag && step < opts.maxSteps) {
    step++;
    let frame = null;
    try { frame = await screenstream.grabFrame(); } catch {}
    if (!frame) { log('err', '抓不到屏幕，停止'); break; }

    let text = '';
    try {
      const prompt = opts.task + PROTOCOL + '\n（这是第 ' + step + ' 步）';
      text = await vision.describe(config.load(), frame.dataUrl, prompt, 'low');
    } catch (e) {
      log('err', '视觉调用失败：' + ((e && e.message) || e));
      break;
    }
    log('see', '👁 ' + text.trim());

    if (/^\s*DONE\s*$/im.test(text)) { log('info', '✅ 模型判断已完成，停止'); break; }

    const m = text.match(/ACTION\s*[:：]\s*([a-z_]+)\s*\|\s*(.+)/i);
    if (!m) { log('wait', '这一步没有动作，等下一次观察'); await sleep(opts.intervalMs); continue; }

    const act = { tool: m[1].trim().toLowerCase(), arg: m[2].trim() };
    const cfg = config.load();
    if (!assistant.TOOL_TIER[act.tool] || !assistant.allowed(cfg.assistant, act.tool)) {
      log('err', '动作不被允许：' + act.tool + '（检查权限档）');
      await sleep(opts.intervalMs);
      continue;
    }
    if (opts.dryRun) { log('act', '（试运行）本应执行：' + act.tool + ' ' + act.arg); await sleep(opts.intervalMs); continue; }

    try {
      const r = await assistant.run(act.tool, act.arg);
      const out = String((r && typeof r === 'object') ? r.text : r).slice(0, 120);
      log('act', '🖱 执行 ' + act.tool + ' ' + act.arg + ' → ' + out);
    } catch (e) {
      log('err', '执行失败：' + ((e && e.message) || e));
    }
    await sleep(opts.intervalMs);
  }
  if (step >= opts.maxSteps && !stopFlag) log('info', '已到最大步数（' + opts.maxSteps + '）');
}

module.exports = { init, start, stop, status };
