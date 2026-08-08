param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [Parameter(Mandatory = $true)]
  [string]$TargetPath
)

$ErrorActionPreference = "Stop"

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$resolvedTarget = (Resolve-Path -LiteralPath $TargetPath -ErrorAction Stop).Path
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput) | Out-Null
Remove-Item -LiteralPath $resolvedOutput -Force -ErrorAction SilentlyContinue

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($resolvedOutput)
$shortcut.TargetPath = $resolvedTarget
$shortcut.Description = "Launch Spirit Vale Overlay"
$shortcut.Save()

if (-not (Test-Path -LiteralPath $resolvedOutput -PathType Leaf)) {
  throw "Could not create portable shortcut: $resolvedOutput"
}
