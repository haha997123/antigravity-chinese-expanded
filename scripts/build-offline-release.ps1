[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $OutputDirectory,
    [Parameter(Mandatory)] [string] $NpmCli,
    [string] $Node = 'node.exe',
    [string] $Revision = 'HEAD'
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$nodeVersion = 'v24.22.3'
$nodeBase = "https://nodejs.org/dist/$nodeVersion"
$nodeChecksums = [ordered]@{
    'win-x64' = '86fc4785327db5f5c7558dc6156c543b433c313e813a222e088086222ab4afa6'
    'win-arm64' = '172e320db179ce416fc012b96b9917dacfb442beb081de57c4deaed7b5a24644'
}
$licenseChecksum = '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace'
$utf8 = [Text.UTF8Encoding]::new($false)

function Get-FileSha256([string] $Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-PinnedFile([string] $Url, [string] $Path, [string] $Hash) {
    if (Test-Path -LiteralPath $Path) {
        if ((Get-FileSha256 $Path) -eq $Hash) { return }
        throw "Cached input has a different SHA-256: $Path"
    }
    $partial = "$Path.part"
    curl.exe --fail --silent --show-error --location --retry 2 --output $partial $Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    if ((Get-FileSha256 $partial) -ne $Hash) { throw "SHA-256 verification failed: $Url" }
    Move-Item -LiteralPath $partial -Destination $Path
}

$output = [IO.Path]::GetFullPath($OutputDirectory)
$npm = (Resolve-Path -LiteralPath $NpmCli).ProviderPath
New-Item -ItemType Directory -Path $output -Force | Out-Null
$commit = (git -C $project rev-parse --verify "$Revision^{commit}")
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the release commit.' }
$commit = $commit.Trim()
$sourceZip = Join-Path $output "$commit-source.zip"
$root = Join-Path $output "stage-$commit"
New-Item -ItemType Directory -Path $root | Out-Null
$prefix = 'antigravity-chinese-expanded'
git -C $project -c core.autocrlf=false archive --format=zip "--prefix=$prefix/" "--output=$sourceZip" $commit
if ($LASTEXITCODE -ne 0) { throw 'Could not archive the release sources.' }
tar.exe -xf $sourceZip -C $root
if ($LASTEXITCODE -ne 0) { throw 'Could not extract the release sources.' }

$package = Join-Path $root $prefix
$packageVersion = (Get-Content -LiteralPath (Join-Path $package 'package.json') -Raw | ConvertFrom-Json).version
$runtime = Join-Path $package 'runtime'
New-Item -ItemType Directory -Path $runtime | Out-Null
foreach ($entry in $nodeChecksums.GetEnumerator()) {
    $source = Join-Path $output "node-$($entry.Key).exe"
    Get-PinnedFile "$nodeBase/$($entry.Key)/node.exe" $source $entry.Value
    $destination = Join-Path $runtime $entry.Key
    New-Item -ItemType Directory -Path $destination | Out-Null
    Copy-Item -LiteralPath $source -Destination (Join-Path $destination 'node.exe')
}
$license = Join-Path $output 'LICENSE.node.txt'
Get-PinnedFile "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" $license $licenseChecksum
Copy-Item -LiteralPath $license -Destination (Join-Path $runtime 'LICENSE.node.txt')

Push-Location -LiteralPath $package
try {
    & $Node $npm ci --omit=dev --ignore-scripts --no-audit --no-fund --no-bin-links
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage the locked npm dependencies.' }
} finally {
    Pop-Location
}
$dependencyRoot = Join-Path $package 'node_modules'
$npmInternalLock = Join-Path $dependencyRoot '.package-lock.json'
if (Test-Path -LiteralPath $npmInternalLock) { Remove-Item -LiteralPath $npmInternalLock }

$packagePathPrefix = $package.TrimEnd('\') + '\'
$hashes = [ordered]@{}
Get-ChildItem -LiteralPath $runtime,$dependencyRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relativePath = $_.FullName.Substring($packagePathPrefix.Length).Replace('\', '/')
    $hashes[$relativePath] = Get-FileSha256 $_.FullName
}
$manifest = [ordered]@{ schemaVersion = 1; sourceCommit = $commit; nodeVersion = $nodeVersion; files = $hashes }
[IO.File]::WriteAllText((Join-Path $runtime 'manifest.json'), (($manifest | ConvertTo-Json -Depth 4) + "`n"), $utf8)

$zipName = "$prefix-$packageVersion.zip"
$zip = Join-Path $output $zipName
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($package, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
$zipSha = Get-FileSha256 $zip
[IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS.txt'), "$zipSha  $zipName`n", $utf8)
Write-Output $zip
Write-Output $zipSha
