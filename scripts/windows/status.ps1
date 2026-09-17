param(
  [string]$TaskName = 'DSH Web Gateway',
  [int]$AdminPort = 3091
)

$ErrorActionPreference = 'Stop'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }
$neverRun = $taskInfo -and $taskInfo.LastTaskResult -eq 267011
$health = $null
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$AdminPort/health" -TimeoutSec 3
} catch {
  $health = [ordered]@{ status = 'unreachable'; reason = $_.Exception.Message }
}

[ordered]@{
  installed = [bool]$task
  taskState = if ($task) { [string]$task.State } else { 'NotInstalled' }
  lastRunTime = if ($taskInfo -and -not $neverRun) { $taskInfo.LastRunTime } else { $null }
  lastTaskResult = if ($neverRun) { 'NeverRun' } elseif ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
  gateway = $health
} | ConvertTo-Json -Depth 4
