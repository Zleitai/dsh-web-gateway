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
  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
  $dataDirectory = Join-Path $repoRoot '.local'
  if (Test-Path -LiteralPath $dataDirectory) {
    Remove-Item -LiteralPath $dataDirectory -Recurse -Force
    Write-Output "Removed local configuration and logs: $dataDirectory"
  }
}
