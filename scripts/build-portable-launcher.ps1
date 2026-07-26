param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [Parameter(Mandatory = $true)]
  [string]$IconPath
)

$ErrorActionPreference = "Stop"

function Find-CSharpCompiler {
  $command = Get-Command "csc.exe" -ErrorAction SilentlyContinue
  if ($command -ne $null) { return $command.Source }

  $candidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }

  throw "Could not find csc.exe to build the portable launcher."
}

$source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string binDirectory = Path.Combine(root, "bin");
        string launcherPath = Path.Combine(binDirectory, "launcher.exe");
        string dataDirectory = Path.Combine(root, "data");
        string runtimeDirectory = Path.Combine(dataDirectory, "runtime");
        string localAppDataDirectory = Path.Combine(runtimeDirectory, "local");
        string roamingAppDataDirectory = Path.Combine(runtimeDirectory, "roaming");
        string tempDirectory = Path.Combine(runtimeDirectory, "temp");
        string webViewDataDirectory = Path.Combine(runtimeDirectory, "webview2");

        if (!File.Exists(launcherPath))
        {
            MessageBox.Show(
                "Could not find bin\\launcher.exe.\n\nExtract the complete portable ZIP, then run Spirit Vale.exe from the extracted folder.",
                "Spirit Vale",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }

        try
        {
            Directory.CreateDirectory(Path.Combine(dataDirectory, "logs"));
            Directory.CreateDirectory(Path.Combine(dataDirectory, "settings"));
            Directory.CreateDirectory(localAppDataDirectory);
            Directory.CreateDirectory(roamingAppDataDirectory);
            Directory.CreateDirectory(tempDirectory);
            Directory.CreateDirectory(webViewDataDirectory);

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = launcherPath,
                WorkingDirectory = binDirectory,
                UseShellExecute = false,
            };
            startInfo.EnvironmentVariables["SPIRIT_VALE_PORTABLE_ROOT"] = root;
            startInfo.EnvironmentVariables["SPIRIT_VALE_LOG_DIRECTORY"] = Path.Combine(dataDirectory, "logs");
            startInfo.EnvironmentVariables["LOCALAPPDATA"] = localAppDataDirectory;
            startInfo.EnvironmentVariables["APPDATA"] = roamingAppDataDirectory;
            startInfo.EnvironmentVariables["TEMP"] = tempDirectory;
            startInfo.EnvironmentVariables["TMP"] = tempDirectory;
            startInfo.EnvironmentVariables["WEBVIEW2_USER_DATA_FOLDER"] = webViewDataDirectory;

            Process.Start(startInfo);
            return 0;
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                "Could not start Spirit Vale.\n\n" + exception.Message,
                "Spirit Vale",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }
}
'@

$sourcePath = Join-Path ([System.IO.Path]::GetTempPath()) ("spirit-vale-launcher-" + [System.Guid]::NewGuid().ToString("N") + ".cs")
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue

try {
  Set-Content -LiteralPath $sourcePath -Value $source -Encoding UTF8
  $compiler = Find-CSharpCompiler
  & $compiler `
    "/nologo" `
    "/target:winexe" `
    "/out:$OutputPath" `
    "/win32icon:$IconPath" `
    "/reference:System.Windows.Forms.dll" `
    $sourcePath
  if ($LASTEXITCODE -ne 0) {
    throw "csc.exe failed with exit code $LASTEXITCODE."
  }
}
finally {
  Remove-Item -LiteralPath $sourcePath -Force -ErrorAction SilentlyContinue
}
