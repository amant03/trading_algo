param(
    [switch]$Stop
)

$ErrorActionPreference = 'Continue'

$candidates = @(
    "C:\Users\amant\Downloads\jdk-22_windows-x64_bin\jdk-22.0.2",
    $env:JAVA_HOME
) | Where-Object { $_ -and (Test-Path (Join-Path $_ "bin\java.exe")) }
if (-not $candidates) { Write-Error "JDK not found"; exit 1 }
$env:JAVA_HOME = $candidates[0]
$env:Path = "$env:JAVA_HOME\bin;" + $env:Path

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$kafkaHome = if ($env:KAFKA_HOME) { $env:KAFKA_HOME } else { Join-Path $root ".infra\kafka_2.13-3.9.0" }
$props = Join-Path $PSScriptRoot "server.properties"
$dataDir = Join-Path $root ".infra\kafka-data"
$logs = Join-Path $root ".infra\logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$java = Join-Path $env:JAVA_HOME "bin\java.exe"
$cp = Join-Path $kafkaHome "libs\*"

if (-not (Test-Path $java) -or -not (Test-Path (Join-Path $kafkaHome "libs"))) {
    Write-Error "Kafka not found at $kafkaHome. Run scripts\kafka\download-kafka.ps1 first."
    exit 1
}

if ($Stop) {
    $kpid = Get-Process -Name java -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*jdk-22*" }
    if ($kpid) { $kpid | Stop-Process -Force; Write-Host "Stopped Kafka (PID $($kpid.Id))." }
    else { Write-Host "No Kafka process found." }
    exit 0
}

# Format storage once (KRaft)
if (-not (Test-Path (Join-Path $dataDir "meta.properties"))) {
    Write-Host "Formatting KRaft storage..."
    $raw = (& $java -cp $cp kafka.tools.StorageTool random-uuid 2>&1 | Out-String)
    $m = [regex]::Match($raw, '[0-9A-Za-z_-]{22}')
    if (-not $m.Success) { Write-Error "Could not generate Kafka cluster UUID. Output: $raw"; exit 1 }
    $uuid = $m.Value
    & $java -cp $cp kafka.tools.StorageTool format -t $uuid -c $props --ignore-formatted 2>&1 | Out-String | Write-Host
    if (-not (Test-Path (Join-Path $dataDir "meta.properties"))) { Write-Error "KRaft format failed."; exit 1 }
    Write-Host "KRaft storage formatted (cluster id $uuid)."
}

$outLog = Join-Path $logs "kafka.out.log"
$errLog = Join-Path $logs "kafka.err.log"

Write-Host "Starting Kafka in background (logs: $outLog)..."
$args = @(
    "-Xmx1G", "-Xms256M", "-server",
    "-Djava.awt.headless=true",
    "-cp", $cp,
    "kafka.Kafka", $props
)
$proc = Start-Process -FilePath $java -ArgumentList $args -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

Write-Host "Started PID $($proc.Id). Waiting for port 9092..."
$deadline = (Get-Date).AddSeconds(90)
$ok = $false
while ((Get-Date) -lt $deadline) {
    if (Get-NetTCPConnection -LocalPort 9092 -State Listen -ErrorAction SilentlyContinue) {
        $ok = $true
        break
    }
    Start-Sleep -Milliseconds 1000
}
if ($ok) { Write-Host "Kafka is UP on 127.0.0.1:9092" }
else {
    Write-Host "Timed out waiting for Kafka. Last log lines:"
    Get-Content $errLog -Tail 15 -ErrorAction SilentlyContinue
    Get-Content $outLog -Tail 15 -ErrorAction SilentlyContinue
}
