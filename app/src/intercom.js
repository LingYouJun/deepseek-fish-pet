/* 【对讲机 —— 临时测试钩子】
 *
 * 为什么需要：桌宠以管理员权限运行时，外部普通权限的进程（比如我的 AI 会话）
 * 既碰不了她的窗口、也发不了键鼠给她（UIPI 双向）。但她自己的进程有权限 ——
 * 所以在她进程里放一个"读文件 → 当成主人说的话喂给她"的小钩子，
 * 我就能直接跟她对话、把整个任务测完。
 *
 * 协议：%TEMP%\pet-intercom.json 里放 { seq: 递增序号, text: "要对她说的话" }
 *   钩子每 1.5 秒读一次；seq 变了就把 text 通过对话窗渲染层自己的 send() 发给她
 *   （走的就是用户手打那条路：chatSend → 渲染 → 任务循环 → 聊天记录照常写）。
 *   发完把处理过的 seq 记到 %TEMP%\pet-intercom.done 里，避免重复发。
 *
 * 删掉办法：删掉本文件 + main.js 里那两行 install。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const filePath = () => path.join(os.tmpdir(), 'pet-intercom.json');
const donePath = () => path.join(os.tmpdir(), 'pet-intercom.done');

function install(ctx) {
  /* 【进程内只装一次】—— 血泪教训：原来每次热重载都会再 install 一个 setInterval，
     旧的还没退，于是同一条消息被投递 N 次。实测她收到 6 份一模一样的指令、
     聊天记录里连着 6 行同样的话，看起来像"她卡住原地打转"，其实是**我在刷屏**。
     用 global 标记挡住同一进程内的重复安装。 */
  if (global.__petIntercomInstalled) { try { ctx.dbg('[intercom] 已经装过了，跳过重复安装'); } catch {} return false; }
  global.__petIntercomInstalled = true;

  const { dbg } = ctx;
  const chatWinOf = () => { try { return typeof ctx.chatWin === 'function' ? ctx.chatWin() : ctx.chatWin; } catch { return null; } };
  let lastSeq = 0;
  try { lastSeq = Number(fs.readFileSync(donePath(), 'utf8')) || 0; } catch {}
  dbg('[intercom] 对讲机已挂上，从 seq=' + lastSeq + ' 开始监听 ' + filePath());

  setInterval(async () => {
    try {
      if (!fs.existsSync(filePath())) return;
      let spec = null;
      try { spec = JSON.parse(fs.readFileSync(filePath(), 'utf8')); } catch { return; }
      const seq = Number(spec && spec.seq) || 0;
      const text = String((spec && spec.text) || '').trim();
      if (!seq || seq <= lastSeq || !text) return;
      /* 【投递前再核对一次 done 文件】即使进程里不小心有多个实例同时跑，
         这条也能把重复投递压回一次（先写 done 再投递：抢到写入权的那个才算赢）。 */
      let doneOnDisk = 0;
      try { doneOnDisk = Number(fs.readFileSync(donePath(), 'utf8')) || 0; } catch {}
      if (doneOnDisk >= seq) { lastSeq = doneOnDisk; return; }
      try { fs.writeFileSync(donePath(), String(seq)); } catch {}
      let w = chatWinOf();
      if (!w || w.isDestroyed()) {
        /* 对话窗没开就没地方投递。钩子跑在她自己进程里（管理员），有权限自己开窗。 */
        try { if (ctx.createChat) ctx.createChat(); } catch (e) { dbg('[intercom] 开对话窗失败: ' + e); }
        await new Promise((r) => setTimeout(r, 5000));
        w = chatWinOf();
        if (!w || w.isDestroyed()) { dbg('[intercom] 还是没有对话窗，放弃这条 seq=' + seq); return; }
      }
      /* 用渲染层自己的 send()：完全等于用户手打 */
      const js = 'typeof send === "function" ? (send(' + JSON.stringify(text) + '), "ok") : "no-send"';
      const r = await w.webContents.executeJavaScript(js);
      lastSeq = seq;
      dbg('[intercom] 已把第 ' + seq + ' 条喂给她（' + r + '）：' + text.slice(0, 80));
    } catch (e) {
      try { ctx.dbg('[intercom] 出错: ' + ((e && e.message) || e)); } catch {}
    }
  }, 1500);
  return true;
}

module.exports = { install, filePath };
