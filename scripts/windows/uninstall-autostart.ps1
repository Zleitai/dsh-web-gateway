param(
  [string]$TaskName = 'DSH Web Gateway',
  [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed scheduled task: $TaskName"
} else {
  Write-Output "Scheduled task was not installed: $TaskName"
}

if ($RemoveData) {
  $dataDirectory = Join-Path $env:LOCALAPPDATA 'DSH Web Gateway'
  if (Test-Path -LiteralPath $dataDirectory) {
    Remove-Item -LiteralPath $dataDirectory -Recurse -Force
    Write-Output "Removed local configuration and logs: $dataDirectory"
  }
}
