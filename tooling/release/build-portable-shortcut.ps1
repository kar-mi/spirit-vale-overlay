param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [Parameter(Mandatory = $true)]
  [string]$TargetPath
)

$ErrorActionPreference = "Stop"

$source = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

[ComImport]
[Guid("00021401-0000-0000-C000-000000000046")]
internal class ShellLink { }

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("000214F9-0000-0000-C000-000000000046")]
internal interface IShellLinkW
{
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int maximumPath, IntPtr findData, uint flags);
    void GetIDList(out IntPtr itemIdList);
    void SetIDList(IntPtr itemIdList);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int maximumName);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int maximumPath);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int maximumPath);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
    void GetHotkey(out short hotkey);
    void SetHotkey(short hotkey);
    void GetShowCmd(out int showCommand);
    void SetShowCmd(int showCommand);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int maximumPath, out int iconIndex);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string shortcutPath, uint reserved);
    void Resolve(IntPtr windowHandle, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string targetPath);
}

public static class PortableShortcut
{
    public static void Create(string outputPath, string targetPath)
    {
        object instance = new ShellLink();
        try
        {
            IShellLinkW link = (IShellLinkW)instance;
            link.SetPath(targetPath);
            link.SetDescription("Launch Spirit Vale Overlay");
            link.SetShowCmd(1);
            // Store a relative resolution hint before saving. The target and shortcut move together
            // when the portable folder is extracted somewhere other than the CI staging directory.
            link.SetRelativePath(outputPath, 0);
            ((IPersistFile)link).Save(outputPath, true);
        }
        finally
        {
            Marshal.FinalReleaseComObject(instance);
        }
    }
}
'@

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$resolvedTarget = [System.IO.Path]::GetFullPath($TargetPath)
if (-not (Test-Path -LiteralPath $resolvedTarget -PathType Leaf)) {
  throw "Shortcut target does not exist: $resolvedTarget"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput) | Out-Null
Remove-Item -LiteralPath $resolvedOutput -Force -ErrorAction SilentlyContinue

Add-Type -TypeDefinition $source -Language CSharp
[PortableShortcut]::Create($resolvedOutput, $resolvedTarget)
if (-not (Test-Path -LiteralPath $resolvedOutput -PathType Leaf)) {
  throw "Could not create portable shortcut: $resolvedOutput"
}
