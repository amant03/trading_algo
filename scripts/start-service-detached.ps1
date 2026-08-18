param(
    [Parameter(Mandatory = $true)]
    [string]$Name
)

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logsDir = Join-Path $root ".infra\logs"
$pidsFile = Join-Path $root ".infra\service-pids.json"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$svcs = @{
    'market-data'       = @{ entry = 'services/market-data/src/index.ts';    cwd = $root; tsx = $true }
    'fundamentals'      = @{ entry = 'services/fundamentals/src/index.ts';   cwd = $root; tsx = $true }
    'news'              = @{ entry = 'services/news/src/index.ts';           cwd = $root; tsx = $true }
    'algorithm-engine'  = @{ entry = 'services/algorithm-engine/src/index.ts'; cwd = $root; tsx = $true }
    'executor'          = @{ entry = 'services/executor/src/index.ts';       cwd = $root; tsx = $true }
    'api'               = @{ entry = 'services/api/src/index.ts';            cwd = $root; tsx = $true }
    'frontend'          = @{ entry = 'node_modules/vite/bin/vite.js';        cwd = Join-Path $root 'frontend'; tsx = $false }
}

if (-not $svcs.ContainsKey($Name)) { Write-Error "Unknown service $Name"; exit 1 }
$svc = $svcs[$Name]
$out = Join-Path $logsDir "$Name.out.log"
$err = Join-Path $logsDir "$Name.err.log"
$args = if ($svc.tsx) { @("node_modules/tsx/dist/cli.mjs", $svc.entry) } else { @($svc.entry) }

$proc = Start-Process -FilePath "node" -ArgumentList $args -WorkingDirectory $svc.cwd `
    -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru

$pids = [ordered]@{}
if (Test-Path $pidsFile) {
    $existing = Get-Content $pidsFile | ConvertFrom-Json
    foreach ($p in $existing.PSObject.Properties) { $pids[$p.Name] = [int]$p.Value }
}
$pids[$Name] = $proc.Id
$pids | ConvertTo-Json | Set-Content -Path $pidsFile

Write-Output "Started $Name (PID $($proc.Id))"