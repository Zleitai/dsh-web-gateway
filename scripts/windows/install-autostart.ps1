param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://[^/]+$')]
  [string]$PublicOrigin,

  [Parameter(Mandatory = $true)]
  [string]$Workspace,

  [string]$TaskName = 'DSH Web Gateway',
  [switch]$StartNow
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'This installer only supports Windows.'
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$workspacePath = (Resolve-Path -LiteralPath $Workspace).Path
$entrypoint = Join-Path $repoRoot 'src\index.mjs'
$runner = Join-Path $PSScriptRoot 'run-gateway.ps1'
$node = Get-Command node.exe -ErrorAction Stop
$dshLauncher = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\lib\bin.js'

if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) {
  throw "Gateway entrypoint was not found at $entrypoint"
}
if (-not (Test-Path -LiteralPath $dshLauncher -PathType Leaf)) {
  throw 'DSH was not found in the current user npm installation.'
}

$installedPowerShell = 'C:\Program Files\PowerShell\7\pwsh.exe'
$powerShell = if (Test-Path -LiteralPath $installedPowerShell -PathType Leaf) {
  $installedPowerShell
} else {
  (Get-Command pwsh.exe -ErrorAction Stop).Source
}

$dataDirectory = Join-Path $env:LOCALAPPDATA 'DSH Web Gateway'
$configPath = Join-Path $dataDirectory 'config.json'
$logPath = Join-Path $dataDirectory 'gateway.log'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

$config = [ordered]@{
  nodePath = $node.Source
  entrypoint = $entrypoint
  publicOrigin = ([Uri]$PublicOrigin).GetLeftPart([System.UriPartial]::Authority)
  workspace = $workspacePath
  dshLauncher = $dshLauncher
  logPath = $logPath
}
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8

$quotedRunner = '"' + $runner + '"'
$quotedConfig = '"' + $configPath + '"'
$actionArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $quotedRunner -ConfigPath $quotedConfig"
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $actionArguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Description 'Starts the local DSH Web Gateway after sign-in.' `
  -Force | Out-Null

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
}

Write-Output "Installed scheduled task: $TaskName"
Write-Output "Configuration: $configPath"
Write-Output "Log: $logPath"
if (-not $StartNow) {
  Write-Output 'The task will start at the next sign-in. The currently running gateway was not restarted.'
}
