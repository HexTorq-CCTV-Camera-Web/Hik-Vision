$ErrorActionPreference = 'Stop'
$taskName = 'Hikvision Windows Viewer V2'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'This startup task already exists. Review it in Task Scheduler before changing it.'
}
$startScript = Join-Path $PSScriptRoot 'start.ps1'
$windowsUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershellPath = Join-Path $PSHOME 'powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $startScript
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $windowsUser
$principal = New-ScheduledTaskPrincipal -UserId $windowsUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Write-Output 'Startup task registered for this Windows user. It will run at next sign-in; the current server was not changed.'
