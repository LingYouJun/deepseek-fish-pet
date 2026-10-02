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

const PS = `Add-Type -TypeDefinition @'
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
  public static uint NOMOVE = 0x2, NOSIZE = 0x1, SHOW = 0x40;
  public static List<string> All = new List<string>();
  public static string Hit = "";
  public static void Go(string want) {
    All.Clear(); Hit = "";
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
        Hit = t;
        return false;
      }
      return true;
    }, IntPtr.Zero);
  }
}
'@
[FW]::Go('__WANT__')
if ([FW]::Hit -ne '') { Write-Output ('OK ' + [FW]::Hit) }
else { Write-Output ('NOTFOUND'); foreach ($w in [FW]::All) { Write-Output ('  visible: ' + $w) } }
`;

function focusWindow(title) {
  return new Promise((resolve) => {
    const want = String(title || '').trim();
    if (!want) return resolve('（没给窗口名）');
    const script = PS.replace('__WANT__', want.replace(/'/g, "''"));
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 25000, windowsHide: true }, (e, so, se) => {
      const out = String(so || '').trim();
      if (e && !out) return resolve('调用失败：' + e.message);
      resolve(out);
    });
  });
}

module.exports = { focusWindow };
