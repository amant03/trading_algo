$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pidsFile = Join-Path $root ".infra\service-pids.json"

if (Test-Path $pidsFile) {
    $pids = Get-Content $pidsFile | ConvertFrom-Json
    foreach ($p in $pids.PSObject.Properties) {
        $proc = Get-Process -Id $p.Value -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $p.Value -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped $($p.Name) (PID $($p.Value))"
        } else {
            Write-Host "$($p.Name): already stopped"
        }
    }
    Remove-Item $pidsFile -Force
} else {
    Write-Host "No service pid file found. Stopping all node tsx / vite service processes..."
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -match 'tsx/dist/cli.mjs.*services|vite\.js' } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped PID $($_.ProcessId)"
        }
}
Write-Host "All services stopped."