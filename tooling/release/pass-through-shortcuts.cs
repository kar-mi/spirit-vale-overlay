using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

// A deliberately narrow global-input observer. It never suppresses or injects
// keyboard input: matched actions are posted to a writer thread after the hook
// has continued Windows' normal input chain.
internal static class Program
{
    private const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101,
        WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105, WM_APP_SHORTCUT = 0x8001, PM_NOREMOVE = 0;

    private sealed class Binding { internal string Action; internal int Key; internal bool Ctrl, Alt, Shift, Meta; }
    private static readonly bool[] Pressed = new bool[256];
    private static Binding[] Bindings = new Binding[0];
    private static uint WriterThreadId;
    private static readonly ManualResetEvent WriterReady = new ManualResetEvent(false);
    private static readonly LowLevelKeyboardProc HookProcedure = HookCallback;

    private delegate IntPtr LowLevelKeyboardProc(int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool PostThreadMessage(uint threadId, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint minimum, uint maximum, uint remove);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint minimum, uint maximum);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

    [StructLayout(LayoutKind.Sequential)] private struct Message {
        internal IntPtr Window; internal uint MessageCode; internal IntPtr WParam; internal IntPtr LParam; internal uint Time; internal int X, Y;
    }

    [STAThread] private static int Main(string[] args)
    {
        try {
            Bindings = ParseBindings(args).ToArray();
            Thread writer = new Thread(WriteActions) { IsBackground = true, Name = "shortcut-action-writer" };
            writer.Start(); WriterReady.WaitOne();
            if (SetWindowsHookEx(WH_KEYBOARD_LL, HookProcedure, IntPtr.Zero, 0) == IntPtr.Zero) return 2;
            Message message; while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
            return 0;
        } catch { return 3; }
    }

    private static void WriteActions()
    {
        Message ignored; PeekMessage(out ignored, IntPtr.Zero, 0, 0, PM_NOREMOVE);
        WriterThreadId = GetCurrentThreadId(); WriterReady.Set();
        Message message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
            if (message.MessageCode != WM_APP_SHORTCUT) continue;
            int index = message.WParam.ToInt32();
            if (index < 0 || index >= Bindings.Length) continue;
            try { Console.Out.WriteLine(Bindings[index].Action); Console.Out.Flush(); }
            catch { Environment.Exit(0); }
        }
    }

    private static IntPtr HookCallback(int code, IntPtr wParam, IntPtr lParam)
    {
        try {
            if (code >= 0) {
                int message = unchecked((int)wParam.ToInt64());
                bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                bool up = message == WM_KEYUP || message == WM_SYSKEYUP;
                if (down || up) {
                    int key = Marshal.ReadInt32(lParam);
                    if (key >= 0 && key < Pressed.Length) {
                        if (up) Pressed[key] = false;
                        else if (!Pressed[key]) {
                            Pressed[key] = true;
                            if (!IsModifier(key)) for (int index = 0; index < Bindings.Length; index++)
                                if (Matches(Bindings[index], key)) { PostThreadMessage(WriterThreadId, WM_APP_SHORTCUT, new IntPtr(index), IntPtr.Zero); break; }
                        }
                    }
                }
            }
        } catch { }
        return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    private static bool Matches(Binding binding, int key)
    {
        return binding.Key == key
            && binding.Ctrl == AnyPressed(0x11, 0xA2, 0xA3)
            && binding.Alt == AnyPressed(0x12, 0xA4, 0xA5)
            && binding.Shift == AnyPressed(0x10, 0xA0, 0xA1)
            && binding.Meta == AnyPressed(0x5B, 0x5C);
    }

    private static bool AnyPressed(params int[] keys)
    {
        foreach (int key in keys) if (Pressed[key]) return true;
        return false;
    }

    private static bool IsModifier(int key)
    {
        return key == 0x10 || key == 0xA0 || key == 0xA1 || key == 0x11 || key == 0xA2 || key == 0xA3
            || key == 0x12 || key == 0xA4 || key == 0xA5 || key == 0x5B || key == 0x5C;
    }

    private static List<Binding> ParseBindings(string[] args)
    {
        List<Binding> bindings = new List<Binding>();
        for (int index = 0; index < args.Length; index += 3) {
            if (index + 2 >= args.Length || args[index] != "--binding") throw new ArgumentException();
            Binding binding = ParseShortcut(args[index + 1], args[index + 2]); if (binding != null) bindings.Add(binding);
        }
        return bindings;
    }

    private static Binding ParseShortcut(string action, string shortcut)
    {
        string[] tokens = shortcut.Split('+'); if (tokens.Length == 0) return null;
        Binding binding = new Binding { Action = action };
        for (int index = 0; index < tokens.Length - 1; index++) switch (tokens[index].Trim().ToLowerInvariant()) {
            case "ctrl": binding.Ctrl = true; break; case "alt": binding.Alt = true; break;
            case "shift": binding.Shift = true; break; case "meta": binding.Meta = true; break; default: return null;
        }
        binding.Key = KeyCode(tokens[tokens.Length - 1].Trim().ToUpperInvariant()); return binding.Key < 0 ? null : binding;
    }

    private static int KeyCode(string key)
    {
        if (key.Length == 1 && key[0] >= 'A' && key[0] <= 'Z') return key[0];
        if (key.Length == 1 && key[0] >= '0' && key[0] <= '9') return key[0];
        if (key.Length >= 2 && key[0] == 'F') { int number; if (Int32.TryParse(key.Substring(1), out number) && number >= 1 && number <= 24) return 0x6F + number; }
        switch (key) {
            case "SPACE": return 0x20; case "ENTER": return 0x0D; case "TAB": return 0x09; case "BACKSPACE": return 0x08; case "DELETE": return 0x2E;
            case "HOME": return 0x24; case "END": return 0x23; case "PAGEUP": return 0x21; case "PAGEDOWN": return 0x22;
            case "ARROWUP": return 0x26; case "ARROWDOWN": return 0x28; case "ARROWLEFT": return 0x25; case "ARROWRIGHT": return 0x27; case "ESCAPE": return 0x1B;
            default: return -1;
        }
    }
}
