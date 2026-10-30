<#
  Installs the local generation engine (ComfyUI) that Kubrick Space drives on 127.0.0.1:8189.

  What it does, in order:
    1. Downloads the exact ComfyUI source archive pinned in local-generation/comfyui/source.json and verifies its SHA-256.
    2. Extracts it to local-generation/comfyui/engine (ComfyUI is GPL-3.0; its LICENSE file is kept).
    3. Creates a Python 3.12 virtual environment in local-generation/comfyui/.venv.
    4. Installs PyTorch (CUDA build from the index pinned in source.json) and the packages in requirements-engine.txt.

  It does not download any model. See the "Models" section of README.md for the files to download and where they go.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\install-engine.ps1 [-SkipPackages] [-PythonPath <path to python.exe 3.12>]
#>
param(
    [switch]$SkipPackages,
    [string]$PythonPath = ''
)

$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$engineRoot = Join-Path $studioRoot 'local-generation\comfyui'
$engineDirectory = Join-Path $engineRoot 'engine'
$venvDirectory = Join-Path $engineRoot '.venv'
$source = Get-Content -LiteralPath (Join-Path $engineRoot 'source.json') -Raw | ConvertFrom-Json

function Find-Python312 {
    param([string]$Requested)
    $candidates = @()
    if ($Requested) { $candidates += , @($Requested) }
    $candidates += , @('py', '-3.12')
    $candidates += , @('python')
    $candidates += , @('python3')
    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate[0] -ErrorAction SilentlyContinue
        if (!$command) { continue }
        $arguments = @()
        if ($candidate.Count -gt 1) { $arguments = $candidate[1..($candidate.Count - 1)] }
        $version = (& $command.Source @arguments --version 2>&1) -join ''
        if ($version -match '^Python 3\.12\.') { return @{ Path = $command.Source; Arguments = $arguments } }
    }
    throw 'Python 3.12 was not found. Install it from https://www.python.org/downloads/ (or pass -PythonPath <path>) and run this script again.'
}

# 1-2. ComfyUI source -------------------------------------------------------------------------------------------
if (Test-Path -LiteralPath (Join-Path $engineDirectory 'main.py')) {
    Write-Host 'ComfyUI is already extracted; skipping the download.'
} else {
    $archive = Join-Path ([IO.Path]::GetTempPath()) ("comfyui-" + $source.commit + '.zip')
    Write-Host "Downloading ComfyUI $($source.version) ($($source.commit))..."
    Invoke-WebRequest -Uri $source.archive -OutFile $archive -UseBasicParsing
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $source.archiveSha256.ToLowerInvariant()) {
        Remove-Item -LiteralPath $archive -Force
        throw "The ComfyUI archive does not match the pinned SHA-256. Expected $($source.archiveSha256), got $actual. Nothing was extracted."
    }
    $staging = Join-Path ([IO.Path]::GetTempPath()) ('comfyui-extract-' + [guid]::NewGuid().ToString('N'))
    Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
    $roots = @(Get-ChildItem -LiteralPath $staging -Directory)
    if ($roots.Count -ne 1) { throw 'The ComfyUI archive must contain a single root folder.' }
    New-Item -ItemType Directory -Path $engineRoot -Force | Out-Null
    Move-Item -LiteralPath $roots[0].FullName -Destination $engineDirectory
    Remove-Item -LiteralPath $staging -Recurse -Force
    Remove-Item -LiteralPath $archive -Force
}
$versionFile = Get-Content -LiteralPath (Join-Path $engineDirectory 'comfyui_version.py') -Raw
if ($versionFile -notmatch ('__version__\s*=\s*"' + [regex]::Escape($source.version) + '"')) {
    throw "The extracted engine is not ComfyUI $($source.version)."
}
foreach ($directory in @('data', 'headless-web')) {
    New-Item -ItemType Directory -Path (Join-Path $engineRoot $directory) -Force | Out-Null
}

# 3-4. Python environment ----------------------------------------------------------------------------------------
if ($SkipPackages) {
    Write-Host 'Skipping the Python environment (-SkipPackages).'
    return
}
if (!(Test-Path -LiteralPath (Join-Path $venvDirectory 'Scripts\python.exe'))) {
    $found = Find-Python312 -Requested $PythonPath
    Write-Host "Creating the Python environment with $($found.Path)..."
    & $found.Path @($found.Arguments) -m venv $venvDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python virtual environment.' }
}
$venvPython = Join-Path $venvDirectory 'Scripts\python.exe'
Write-Host 'Installing PyTorch (this downloads several GB)...'
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install torch torchvision --index-url $source.pytorchIndex
if ($LASTEXITCODE -ne 0) { throw 'PyTorch could not be installed.' }
Write-Host 'Installing the remaining engine packages...'
& $venvPython -m pip install -r (Join-Path $engineRoot 'requirements-engine.txt')
if ($LASTEXITCODE -ne 0) { throw 'The engine packages could not be installed.' }
Write-Host 'Done. The engine starts automatically the first time Kubrick Space needs local generation.'
