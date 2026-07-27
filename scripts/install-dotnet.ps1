$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$temporaryDirectory = Join-Path $projectRoot ".tmp"
$installDirectory = Join-Path $projectRoot ".tools\dotnet"
$installer = Join-Path $temporaryDirectory "dotnet-install.ps1"

New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $installDirectory) | Out-Null

Invoke-WebRequest -UseBasicParsing "https://dot.net/v1/dotnet-install.ps1" -OutFile $installer
& $installer -Channel "8.0" -Quality "GA" -InstallDir $installDirectory -NoPath
