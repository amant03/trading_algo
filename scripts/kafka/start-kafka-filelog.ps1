param()

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$java = "C:\Users\amant\Downloads\jdk-22_windows-x64_bin\jdk-22.0.2\bin\java.exe"
$cp = Join-Path $root ".infra\kafka_2.13-3.9.0\libs\*"
$props = Join-Path $PSScriptRoot "server.properties"
$log4j = Join-Path $root ".infra\kafka_2.13-3.9.0\config\log4j.properties"
$logs = Join-Path $root ".infra\logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$outLog = Join-Path $logs "kafka.out.log"
$errLog = Join-Path $logs "kafka.err.log"

$args = @(
    "-Xmx1G", "-Xms256M", "-server",
    "-Djava.awt.headless=true",
    "-Dkafka.logs.dir=$logs",
    "-Dlog4j.configuration=file:$log4j",
    "-cp", $cp,
    "kafka.Kafka", $props
)

$proc = Start-Process -FilePath $java -ArgumentList $args -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
Write-Output "started kafka pid=$($proc.Id)"

$deadline = (Get-Date).AddSeconds(90)
$ok = $false
while ((Get-Date) -lt $deadline) {
    if (Get-NetTCPConnection -LocalPort 9092 -State Listen -ErrorAction SilentlyContinue) {
        $ok = $true
        break
    }
    Start-Sleep -Milliseconds 1000
}
Write-Output "kafka up=$ok"