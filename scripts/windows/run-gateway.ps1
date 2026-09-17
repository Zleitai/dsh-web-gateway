param(
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'

$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json

foreach ($property in @('nodePath', 'entrypoint', 'publicOrigin', 'workspace', 'logPath')) {
  if (-not $config.$property) {
    throw "Missing '$property' in $resolvedConfig"
  }
}

if (-not (Test-Path -LiteralPath $config.nodePath -PathType Leaf)) {
  throw "Node.js was not found at $($config.nodePath)"
}
if (-not (Test-Path -LiteralPath $config.entrypoint -PathType Leaf)) {
  throw "Gateway entrypoint was not found at $($config.entrypoint)"
}
if (-not (Test-Path -LiteralPath $config.workspace -PathType Container)) {
  throw "Workspace was not found at $($config.workspace)"
}

$logDirectory = Split-Path -Parent $config.logPath
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
if ((Test-Path -LiteralPath $config.logPath) -and (Get-Item -LiteralPath $config.logPath).Length -gt 5MB) {
  $archive = Join-Path $logDirectory 'gateway.previous.log'
  Move-Item -LiteralPath $config.logPath -Destination $archive -Force
}

$arguments = @(
  $config.entrypoint,
  '--public-origin', $config.publicOrigin,
  '--workspace', $config.workspace
)
if ($config.dshLauncher) {
  $arguments += @('--dsh-launcher', $config.dshLauncher)
}

"[$(Get-Date -Format o)] Starting DSH Web Gateway" | Add-Content -LiteralPath $config.logPath
& $config.nodePath @arguments *>> $config.logPath
exit $LASTEXITCODE
