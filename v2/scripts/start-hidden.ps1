$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $nodePath -ArgumentList @('--env-file-if-exists=.env','server.mjs') -WorkingDirectory $appRoot -WindowStyle Hidden
