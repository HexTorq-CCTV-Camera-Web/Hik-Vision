$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction Stop
$pythonCommand = if ($env:HIK_PYTHON) { $env:HIK_PYTHON } else { (Get-Command python -ErrorAction Stop).Source }
Write-Output 'Node'
& $nodeCommand.Source --version
Write-Output 'Python media dependencies'
& $pythonCommand (Join-Path $appRoot 'tools/dependencies.py')
if ($LASTEXITCODE -ne 0) { throw 'Install the native/requirements.txt dependencies using the configured Python.' }
Write-Output 'Installed SDK exports'
& $pythonCommand (Join-Path $appRoot 'tools/sdk-inventory.py')
if ($LASTEXITCODE -ne 0) { throw 'The installed iVMS SDK is unavailable.' }
Write-Output 'Diagnostics completed. This checks dependencies, not account authorization or live playback.'
