param(
    [string]$Version = "3.9.0",
    [string]$Scala = "2.13"
)

$ErrorActionPreference = 'Stop'

# Locate real JDK (PATH has a Store stub that must be avoided)
$candidates = @(
    "C:\Users\amant\Downloads\jdk-22_windows-x64_bin\jdk-22.0.2",
    $env:JAVA_HOME
) | Where-Object { $_ -and (Test-Path (Join-Path $_ "bin\java.exe")) }

if (-not $candidates) {
    Write-Error "Java 17+ (JDK) not found. Install a JDK or set JAVA_HOME."
    exit 1
}
$env:JAVA_HOME = $candidates[0]
$env:Path = "$env:JAVA_HOME\bin;" + $env:Path
Write-Host "Using JAVA_HOME=$env:JAVA_HOME"

$baseDir = Join-Path $PSScriptRoot "..\..\.infra"
$kafkaDir = Join-Path $baseDir "kafka_$Scala-$Version"
New-Item -ItemType Directory -Force -Path $baseDir | Out-Null

if (-not (Test-Path (Join-Path $kafkaDir "bin\windows\kafka-server-start.bat"))) {
    Write-Host "Downloading Apache Kafka $Version (this is ~130MB, one-time)..."
    $url = "https://downloads.apache.org/kafka/$Version/kafka_$Scala-$Version.tgz"
    $tgz = Join-Path $baseDir "kafka.tgz"
    curl.exe -L --retry 3 -o $tgz $url
    if (-not (Test-Path $tgz)) { Write-Error "Download failed"; exit 1 }
    Write-Host "Extracting..."
    tar -xzf $tgz -C $baseDir
    Remove-Item $tgz -Force
}
Write-Host "Kafka ready at $kafkaDir"
