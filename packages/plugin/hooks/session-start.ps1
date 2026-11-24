$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'session-start.mjs')
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
