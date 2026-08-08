param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

function Find-CSharpCompiler {
  $command = Get-Command "csc.exe" -ErrorAction SilentlyContinue
  if ($command -ne $null) { return $command.Source }
  foreach ($candidate in @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "Could not find csc.exe to build the pass-through shortcut helper."
}

$sourcePath = Join-Path $PSScriptRoot "pass-through-shortcuts.cs"
if (!(Test-Path -LiteralPath $sourcePath)) {
  throw "Pass-through shortcut helper source is missing: $sourcePath"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue

& (Find-CSharpCompiler) "/nologo" "/target:winexe" "/optimize+" "/out:$OutputPath" $sourcePath
if ($LASTEXITCODE -ne 0) { throw "csc.exe failed with exit code $LASTEXITCODE." }
