# Windows entry for the dev setup. Requires Node.js 20 or newer.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
& node (Join-Path $PSScriptRoot 'setup.mjs')
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
