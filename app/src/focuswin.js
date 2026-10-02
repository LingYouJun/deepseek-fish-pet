/* focus_window —— 把指定标题的窗口提到最前面（她自己是管理员，做得到）
 *
 * 为什么需要：她反复被"游戏窗口被别的窗口盖住"挡住（"屏幕上是 DeepSeek 聊天界面，
 * 不是明日方舟，我根本看不到游戏"）。她提不动前台窗口（Windows 只允许前台进程改前台），
 * 但她可以用 SetWindowPos(HWND_TOPMOST) 把目标窗口**视觉上抬到最上面** ——
 * 鼠标点击和截图看到的都是最上面的窗口，所以抬起来就够用了。
 * 实测这招有效（之前我用它把鹰角启动器抬起来过）。
 *
 * 用法：focus_window|明日方舟        （按标题子串找，找不到就报出所有可见窗口名）
 */
const { execFile } = require('child_process');

const PS = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public class FW {
  [DllImport("user32.dll")] static extern bool EnumWindows(EP cb, IntPtr p);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  public delegate bool EP(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L,T,Rr,B; }
  public static IntPtr TOP = new IntPtr(-1);
  public static IntPtr NOTOP = new IntPtr(-2);
  public static uint NOMOVE = 0x2, NOSIZE = 0x1, SHOW = 0x40;
  public static List<string> All = new List<string>();
  public static string Hit = "";
  public static IntPtr HitH = IntPtr.Zero;
  /* 抬起来之后**必须放回去**：第一版只做了 TOPMOST、没有 NOTOPMOST，
     结果游戏被**永久置顶** —— 用户报"我的游戏一直顶窗口，导致我很难和桌宠对话和你对话"。
     现在抬完登记一下，8 秒后自动取消置顶（够她截一张图、点一下，然后就把画面还给你）。 */
  public static void Go(string want) {
    All.Clear(); Hit = ""; HitH = IntPtr.Zero;
    EnumWindows((h,p) => {
      var sb = new StringBuilder(300); GetWindowText(h, sb, 300);
      string t = sb.ToString();
      if (t.Length > 0 && IsWindowVisible(h)) {
        R r; GetWindowRect(h, out r);
        All.Add(t + " [" + r.L + "," + r.T + " " + (r.Rr-r.L) + "x" + (r.B-r.T) + "]");
      }
      if (want.Length > 0 && t.IndexOf(want, StringComparison.OrdinalIgnoreCase) >= 0) {
        if (IsIconic(h)) ShowWindow(h, 9);
        ShowWindow(h, 5);
        SetWindowPos(h, TOP, 0, 0, 0, 0, NOMOVE | NOSIZE | SHOW);
        Hit = t; HitH = h;
        return false;
      }
      return true;
    }, IntPtr.Zero);
  }
  public static void UnTop() {
    if (HitH != IntPtr.Zero) SetWindowPos(HitH, NOTOP, 0, 0, 0, 0, NOMOVE | NOSIZE);
  }
  /* 不管找没找到，先把所有置顶窗口取消置顶（救"已经被卡住"的情况）。
   * ⚠️⚠️ **必须排除调用者自己的进程**：用户报"我一切到别的界面，桌宠就不见了、退到后台了"——
   *   根因就是这里：它把**桌宠自己的 WS_EX_TOPMOST 也抹掉了**，而 Electron 并不知道这个位
   *   被 Win32 抹过，不会重新置顶 → 于是用户一切窗口，桌宠就沉到后面。
   *   （实测证据：dayu-pet 窗口 WS_EX_TOPMOST=False，而 Electron 代码里写的是 alwaysOnTop:true。）
   *   排除办法：用 GetWindowThreadProcessId 拿到窗口所属进程，等于调用者 pid 的一律跳过。 */
  public static List<string> ClearAllTop(uint ownPid) {
    var o = new List<string>();
    EnumWindows((h,p) => {
      var sb = new StringBuilder(300); GetWindowText(h, sb, 300);
      string t = sb.ToString();
      if (t.Length > 0 && IsWindowVisible(h)) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (ownPid != 0 && pid == ownPid) return true;   // ★ 自己的窗口不碰（桌宠/对话窗要一直置顶）
        SetWindowPos(h, NOTOP, 0, 0, 0, 0, NOMOVE | NOSIZE);
        o.Add(t);
      }
      return true;
    }, IntPtr.Zero);
    return o;
  }
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
[FW]::ClearAllTop(__OWNPID__) | Out-Null
[FW]::Go('__WANT__')
if ([FW]::Hit -ne '') {
  Write-Output ('OK ' + [FW]::Hit)
  Start-Sleep -Seconds 8
  [FW]::UnTop()
  Write-Output ('UNTOP done')
} else { Write-Output ('NOTFOUND'); foreach ($w in [FW]::All) { Write-Output ('  visible: ' + $w) } }
`;

/* 【占位符替换集中在一处】—— 这个函数是血泪教训换来的：
 * PowerShell 脚本模板里有 __WANT__ 和 __OWNPID__ 两个占位符，谁忘了替换哪一个，
 * 谁就会把字面量送进 PowerShell → 语法错误 → 那个工具整个失效，而 `node --check` 完全查不出来。
 * 实测在同一个下午连续踩了三次：
 *   ① clearAllTop 忘了传自己的 pid（导致桌宠自己的置顶被抹掉 → 用户"切窗口桌宠就不见了"）
 *   ② focusWindow 加了 __OWNPID__ 后忘了替换（她报"focus_window is broken"）
 *   ③ listWindows 同样忘了（返回 0 个窗口）
 * 所以：**只保留这一个组装入口**，任何新加的 PS 调用都必须走它。 */
function buildScript(want) {
  return PS.replace('__WANT__', String(want == null ? '' : want).replace(/'/g, "''"))
           .replace('__OWNPID__', String(process.pid));
}

function runPs(want, timeoutMs) {
  return new Promise((resolve) => {
    const script = buildScript(want);
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { timeout: timeoutMs || 25000, windowsHide: true },
      (e, so) => resolve(String(so || '').trim() || (e ? 'ERR ' + e.message : '')));
  });
}

function focusWindow(title) {
  return new Promise((resolve) => {
    const want = String(title || '').trim();
    if (!want) return resolve('（没给窗口名）');
    runPs(want).then((out) => (out ? resolve(out) : resolve('调用失败：没有输出')));
  });
}

/* 只清"置顶"、不抬任何窗口 —— 启动时调一次，救"已经被卡成永久置顶"的情况。
 * 复用 focusWindow('')：它内部的 PowerShell 一开始就会 [FW]::ClearAllTop()，
 * 而 want 为空时 Go() 不会匹配任何窗口，等于纯清理。
 * ⚠️ 为什么必须由她（提权运行）在启动时做：只有管理员权限的进程动得了管理员窗口。
 *    我这个普通权限的会话实测 SetWindowPos(NOTOPMOST) 对"明日方舟"返回 err=5（Access Denied）。 */
function clearAllTop() {
  /* ⚠️ 不能转调 focusWindow('')：那个函数对空标题会**早退**（"没给窗口名"），
     PowerShell 根本不会跑 —— 我第一版就是这么写的，等于没清。这里直接跑脚本。
     ⚠️ 必须把自己的 pid 传进去：这样桌宠/对话窗自己的置顶不会被抹掉
     （用户报"一切到别的界面桌宠就不见了"，就是这个抹掉的后果）。 */
  return runPs('', 25000).then((out) => out || 'done');
}

/* 列出当前可见窗口（标题 + 位置尺寸）。
 * 抄自参考项目 Coopanion 的 cua_windows（packages/cortico-world-cua/src/world.ts:316-340）：
 * 它给模型提供一条**廉价的结构化通道** —— 窗口标题 + 矩形（已换算成截图像素），
 * 这样"切窗口/知道某个窗口在哪"就不用靠模型瞎猜坐标。
 *
 * ⚠️ 坐标系：这个 PowerShell 子进程**不是 DPI-aware** 的，Windows 会给它**虚拟化**过的坐标
 *    （物理像素 ÷ scaleFactor）。而我们的截图空间是**物理像素**（1920x1080）。
 *    所以返回前必须乘回 scaleFactor，否则她会按虚拟坐标去点，全部偏 25%（实测本机 1.25）。
 */
function listWindows() {
  return new Promise((resolve) => {
    runPs('', 25000).then((so) => {
      const out = String(so || '');
      const rows = [];
      const re = /visible:\s*(.+?)\s*\[(-?\d+),(-?\d+)\s+(\d+)x(\d+)\]/g;
      let m;
      while ((m = re.exec(out))) {
        rows.push({ title: m[1].trim(), x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]) });
      }
      resolve(rows);
    });
  });
}

module.exports = { focusWindow, clearAllTop, listWindows };
