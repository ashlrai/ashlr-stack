# Windows twin of scripts/fast-check.sh.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
& node (Join-Path $PSScriptRoot 'fast-check.mjs')
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
