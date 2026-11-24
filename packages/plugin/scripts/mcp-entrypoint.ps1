$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'mcp-entrypoint.mjs')
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
