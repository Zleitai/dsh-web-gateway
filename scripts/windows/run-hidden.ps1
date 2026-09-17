param(
  [Parameter(Mandatory = $true)]
  [string]$RunnerPath,

  [Parameter(Mandatory = $true)]
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'

$resolvedRunner = (Resolve-Path -LiteralPath $RunnerPath).Path
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
if (-not $config.nodePath -or -not (Test-Path -LiteralPath $config.nodePath -PathType Leaf)) {
  throw "Node.js was not found at $($config.nodePath)"
}

& $config.nodePath $resolvedRunner $resolvedConfig
exit $LASTEXITCODE
