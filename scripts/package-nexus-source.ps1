$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw |
    ConvertFrom-Json
$version = $manifest.version
$tempRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot ".tmp"))
$stage = [System.IO.Path]::GetFullPath(
    (Join-Path $tempRoot "nexus-source-$version")
)
$nexusDirectory = Join-Path $projectRoot "Nexus"
$archivePath = Join-Path $nexusDirectory "DSR-Randomizer-Source-$version.zip"
$separator = [System.IO.Path]::DirectorySeparatorChar

if (-not $stage.StartsWith(
        $tempRoot.TrimEnd($separator) + $separator,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Source staging path escaped the temporary directory: $stage"
}
if (Test-Path -LiteralPath $archivePath) {
    throw "Source archive already exists: $archivePath"
}

New-Item -ItemType Directory -Force -Path $nexusDirectory | Out-Null
if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null

try {
    foreach ($directory in @("public", "src", "docs")) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $directory) `
            -Destination $stage -Recurse
    }
    $toolDirectory = Join-Path $stage "tools/DsrDataTool"
    New-Item -ItemType Directory -Force -Path $toolDirectory | Out-Null
    foreach ($file in @("Program.cs", "DsrDataTool.csproj")) {
        Copy-Item -LiteralPath (Join-Path $projectRoot "tools/DsrDataTool/$file") `
            -Destination $toolDirectory
    }
    foreach ($file in @(
        "package.json",
        "package-lock.json",
        "NuGet.Config",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md"
    )) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $file) `
            -Destination $stage
    }
    Copy-Item -LiteralPath (Join-Path $projectRoot "docs/NEXUS_SOURCE_INSTALL.txt") `
        -Destination (Join-Path $stage "README.txt")

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stage,
        $archivePath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $forbiddenEntries = @(
            $archive.Entries |
                Where-Object { $_.FullName -match "\.(exe|dll|zip|7z|rar|bat)$" }
        )
        if ($forbiddenEntries.Count -gt 0) {
            throw "Source archive contains executable or nested archive files: $($forbiddenEntries.FullName -join ', ')"
        }
    }
    finally {
        $archive.Dispose()
    }
    Get-Item -LiteralPath $archivePath |
        Select-Object FullName, Length, LastWriteTime
}
catch {
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
