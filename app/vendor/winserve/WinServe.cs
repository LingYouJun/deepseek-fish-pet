// WinServe.cs -- persistent native helper for window / cursor queries (serve mode)
// Build: C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:winserve.exe WinServe.cs
// Protocol: stdin lines -> stdout one JSON line per command.
//   list  -> {ok,dpi,dpiOk,windows:[{title,x,y,w,h,hwnd,pid,iconic,visible,topmost,cloaked,z}],fg:{title,hwnd}}
//   cursor-> {ok,x,y}
//   ping  -> {ok}
//   quit  -> {ok} then exit
// NOTE: keep this file ASCII-only.
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;

class WinServe
{
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern uint GetDpiForSystem();
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

    static bool dpiOk = false;

    static string TitleOf(IntPtr h)
    {
        var sb = new StringBuilder(512);
        GetWindowTextW(h, sb, 512);
        return sb.ToString();
    }
    static bool Cloaked(IntPtr h)
    {
        int v = 0;
        try { DwmGetWindowAttribute(h, 14, out v, 4); } catch { }
        return v != 0;
    }
    static string Esc(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default: if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c); break;
            }
        }
        return sb.ToString();
    }

    static List<string> rows;
    static int z;

    static string CmdList()
    {
        rows = new List<string>();
        z = 0;
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            string t = TitleOf(h);
            if (t.Length > 0)
            {
                RECT r; GetWindowRect(h, out r);
                uint pid; GetWindowThreadProcessId(h, out pid);
                int w = r.R - r.L, hh = r.B - r.T;
                bool topmost = (GetWindowLong(h, -20) & 0x8) != 0;
                rows.Add("{\"title\":\"" + Esc(t) + "\",\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + w + ",\"h\":" + hh
                    + ",\"hwnd\":" + h.ToInt64() + ",\"pid\":" + pid
                    + ",\"iconic\":" + (IsIconic(h) ? "true" : "false")
                    + ",\"visible\":" + (IsWindowVisible(h) ? "true" : "false")
                    + ",\"topmost\":" + (topmost ? "true" : "false")
                    + ",\"cloaked\":" + (Cloaked(h) ? "true" : "false")
                    + ",\"z\":" + (z++) + "}");
            }
            return true;
        }, IntPtr.Zero);

        IntPtr fg = GetForegroundWindow();
        string fgTitle = fg == IntPtr.Zero ? "" : TitleOf(fg);
        var sb = new StringBuilder();
        sb.Append("{\"ok\":true,\"dpi\":").Append(GetDpiForSystem())
          .Append(",\"dpiOk\":").Append(dpiOk ? "true" : "false")
          .Append(",\"windows\":[").Append(string.Join(",", rows.ToArray())).Append("]")
          .Append(",\"fg\":{\"title\":\"").Append(Esc(fgTitle)).Append("\",\"hwnd\":").Append(fg.ToInt64()).Append("}}");
        return sb.ToString();
    }

    static string CmdCursor()
    {
        POINT p; GetCursorPos(out p);
        return "{\"ok\":true,\"x\":" + p.X + ",\"y\":" + p.Y + "}";
    }

    static void Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = Encoding.UTF8;
        dpiOk = SetProcessDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero;
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            string cmd = line.Trim();
            string resp;
            try
            {
                if (cmd == "list") resp = CmdList();
                else if (cmd == "cursor") resp = CmdCursor();
                else if (cmd == "ping") resp = "{\"ok\":true}";
                else if (cmd == "quit") { resp = "{\"ok\":true}"; Console.Out.WriteLine(resp); Console.Out.Flush(); return; }
                else resp = "{\"ok\":false,\"error\":\"unknown cmd\"}";
            }
            catch (Exception e)
            {
                resp = "{\"ok\":false,\"error\":\"" + Esc(e.Message) + "\"}";
            }
            Console.Out.WriteLine(resp);
            Console.Out.Flush();
        }
    }
}
