$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction Stop
Push-Location -LiteralPath $appRoot
try {
    & $nodeCommand.Source --env-file-if-exists=.env server.mjs
    exit $LASTEXITCODE
} finally { Pop-Location }
