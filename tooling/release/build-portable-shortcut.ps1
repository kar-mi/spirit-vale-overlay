param(
  [Parameter(Mandatory = $true)] [string]$OutputPath,
  [Parameter(Mandatory = $true)] [string]$TargetPath
)

$ErrorActionPreference = "Stop"
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$resolvedTarget = (Resolve-Path -LiteralPath $TargetPath -ErrorAction Stop).Path
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput) | Out-Null
Remove-Item -LiteralPath $resolvedOutput -Force -ErrorAction SilentlyContinue

Add-Type -Path (Join-Path $PSScriptRoot "portable-shortcut.cs")
[PortableShortcut]::Create($resolvedOutput, $resolvedTarget, "Launch Spirit Vale Overlay")

if (-not (Test-Path -LiteralPath $resolvedOutput -PathType Leaf)) {
  throw "Could not create portable shortcut: $resolvedOutput"
}
