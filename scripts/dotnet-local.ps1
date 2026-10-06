$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$dotnet = Join-Path $projectRoot ".tools\dotnet\dotnet.exe"
$toolRoot = Join-Path $projectRoot ".tools"

if (-not (Test-Path -LiteralPath $dotnet)) {
    $systemDotnet = Get-Command "dotnet" -ErrorAction SilentlyContinue
    if (-not $systemDotnet) {
        throw "No .NET SDK found. Install the .NET 8 SDK or run scripts\install-dotnet.ps1."
    }
    $dotnet = $systemDotnet.Source
}

$env:DOTNET_CLI_HOME = Join-Path $toolRoot "cli-home"
$env:NUGET_PACKAGES = Join-Path $toolRoot "nuget"
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$env:DOTNET_CLI_UI_LANGUAGE = "en-US"
$env:VSLANG = "1033"

& $dotnet @args
exit $LASTEXITCODE
