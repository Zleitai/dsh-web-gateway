param(
  [string]$TaskName = 'DSH Web Gateway',
  [int]$AdminPort = 3091,
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  throw "Scheduled task is not installed: $TaskName"
}

if ([string]$task.State -ne 'Running') {
  Start-ScheduledTask -TaskName $TaskName
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$AdminPort/health" -TimeoutSec 3
    if ($health.status -eq 'ok') {
      [ordered]@{
        status = 'started'
        taskState = [string](Get-ScheduledTask -TaskName $TaskName).State
        gateway = $health
      } | ConvertTo-Json -Depth 4
      exit 0
    }
  } catch {
    # DSH may need about a minute to load plugins before the admin server starts.
  }
  Start-Sleep -Milliseconds 750
} while ((Get-Date) -lt $deadline)

$task = Get-ScheduledTask -TaskName $TaskName
$taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
throw "Gateway did not become healthy within $TimeoutSeconds seconds (task: $($task.State), result: $($taskInfo.LastTaskResult))."
