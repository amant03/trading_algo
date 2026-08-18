param(
    [string[]]$Only
)

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logsDir = Join-Path $root ".infra\logs"
$pidsFile = Join-Path $root ".infra\service-pids.json"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

# Stop any existing instances first
& (Join-Path $PSScriptRoot "stop-all.ps1") | Out-Null
Start-Sleep -Milliseconds 500

$services = @(
    @{ name = 'market-data';   entry = 'services/market-data/src/index.ts';  port = $null },
    @{ name = 'fundamentals';  entry = 'services/fundamentals/src/index.ts'; port = $null },
    @{ name = 'news';          entry = 'services/news/src/index.ts';         port = $null },
    @{ name = 'algorithm-engine'; entry = 'services/algorithm-engine/src/index.ts'; port = $null },
    @{ name = 'executor';      entry = 'services/executor/src/index.ts';     port = $null },
    @{ name = 'api';           entry = 'services/api/src/index.ts';          port = 8080 },
    @{ name = 'frontend';      entry = 'node_modules/vite/bin/vite.js';      port = 5173; cwd = 'frontend' }
)

$pids = [ordered]@{}
foreach ($svc in $services) {
    if ($Only -and $svc.name -notin $Only) { continue }
    $out = Join-Path $logsDir "$($svc.name).out.log"
    $err = Join-Path $logsDir "$($svc.name).err.log"
    $wd = if ($svc.cwd) { Join-Path $root $svc.cwd } else { $root }
    $argsList = if ($svc.cwd) { @($svc.entry) } else { @("node_modules/tsx/dist/cli.mjs", $svc.entry) }
    $proc = Start-Process -FilePath "node" `
        -ArgumentList $argsList `
        -WorkingDirectory $wd `
        -WindowStyle Hidden `
        -RedirectStandardOutput $out -RedirectStandardError $err `
        -PassThru
    $pids[$svc.name] = $proc.Id
    Write-Host "Started $($svc.name) (PID $($proc.Id))"
    Start-Sleep -Milliseconds 800
}

$pids | ConvertTo-Json | Set-Content -Path $pidsFile
Write-Host "`nAll services launched. Logs: $logsDir"