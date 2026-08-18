param(
    [Parameter(Mandatory = $true)]
    [string[]]$Name
)

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logsDir = Join-Path $root ".infra\logs"
$pidsFile = Join-Path $root ".infra\service-pids.json"

$all = @(
    @{ name = 'market-data';   entry = 'services/market-data/src/index.ts';  port = $null },
    @{ name = 'fundamentals';  entry = 'services/fundamentals/src/index.ts'; port = $null },
    @{ name = 'news';          entry = 'services/news/src/index.ts';         port = $null },
    @{ name = 'algorithm-engine'; entry = 'services/algorithm-engine/src/index.ts'; port = $null },
    @{ name = 'executor';      entry = 'services/executor/src/index.ts';     port = $null },
    @{ name = 'api';           entry = 'services/api/src/index.ts';          port = 8080 },
    @{ name = 'frontend';      entry = 'node_modules/vite/bin/vite.js';      port = 5173; cwd = 'frontend' }
)

$pids = [ordered]@{}
if (Test-Path $pidsFile) {
    $existing = Get-Content $pidsFile | ConvertFrom-Json
    foreach ($p in $existing.PSObject.Properties) { $pids[$p.Name] = [int]$p.Value }
}

foreach ($svc in $all) {
    if ($Name -notcontains $svc.name) { continue }
    $old = $pids[$svc.name]
    if ($old) {
        $proc = Get-Process -Id $old -ErrorAction SilentlyContinue
        if ($proc) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue; Write-Host "Stopped old $($svc.name) (PID $old)" }
        Start-Sleep -Milliseconds 600
        $pids.Remove($svc.name)
    }
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
    Start-Sleep -Milliseconds 900
}

$pids | ConvertTo-Json | Set-Content -Path $pidsFile
Write-Host "Done."
