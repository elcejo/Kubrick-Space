param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$runtimeRoot = Join-Path $ProjectRoot '.system_generated/runtime'
$pointerFile = Join-Path $runtimeRoot 'node-path.txt'
$nodeExecutable = $null
$externalConfigured = $null
if (Test-Path -LiteralPath $pointerFile -PathType Leaf) {
    $configured = (Get-Content -LiteralPath $pointerFile -Raw).Trim()
    if ($configured) {
        if ([IO.Path]::IsPathRooted($configured)) { $externalConfigured = $configured } else {
            $candidate = Join-Path $ProjectRoot $configured
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $nodeExecutable = (Resolve-Path -LiteralPath $candidate).Path }
        }
    }
}
if (!$nodeExecutable -and (Test-Path -LiteralPath $runtimeRoot -PathType Container)) {
    $bundled = Get-ChildItem -LiteralPath $runtimeRoot -Directory -Filter 'node-v24.*-win-*' |
        Sort-Object { [version]($_.Name -replace '^node-v', '' -replace '-win-.*$', '') } -Descending
    foreach ($runtime in $bundled) {
        $candidate = Join-Path $runtime.FullName 'node.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $nodeExecutable = $candidate; break }
    }
}
if (!$nodeExecutable -and $externalConfigured -and (Test-Path -LiteralPath $externalConfigured -PathType Leaf)) { $nodeExecutable = (Resolve-Path -LiteralPath $externalConfigured).Path }
if (!$nodeExecutable) { $nodeExecutable = (Get-Command node -ErrorAction Stop).Source }
# Bundled runtimes remain relocatable. External system installations keep their
# own native path; no old project directory is required after a move.
$prefix = $ProjectRoot + [IO.Path]::DirectorySeparatorChar
if ($nodeExecutable.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    Set-Content -LiteralPath $pointerFile -Value ($nodeExecutable.Substring($prefix.Length).Replace('\', '/'))
}
Write-Output $nodeExecutable
