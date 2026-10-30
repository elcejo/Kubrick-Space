param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8189
)

$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$engineRoot = Join-Path $studioRoot 'local-generation\comfyui'
$engineDirectory = Join-Path $engineRoot 'engine'
$pythonExecutable = Join-Path $engineRoot '.venv\Scripts\python.exe'
$source = Get-Content -LiteralPath (Join-Path $engineRoot 'source.json') -Raw | ConvertFrom-Json
$models = Get-Content -LiteralPath (Join-Path $engineRoot 'models.json') -Raw | ConvertFrom-Json
if (!(Test-Path -LiteralPath $pythonExecutable) -or !(Test-Path -LiteralPath (Join-Path $engineDirectory 'main.py'))) {
    throw 'Falta la instalación local de ComfyUI. Consulta local-generation/comfyui/README.md.'
}
$versionSource = Get-Content -LiteralPath (Join-Path $engineDirectory 'comfyui_version.py') -Raw
if ($source.version -ne '0.43.0' -or $versionSource -notmatch '__version__\s*=\s*"0\.43\.0"') {
    throw 'Este lanzador requiere exactamente ComfyUI 0.43.0.'
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "El puerto $Port ya está ocupado. No se inició otra instancia."
}
if ($models.version -eq 2) {
    $defaultModel = $models.models | Where-Object { $_.id -eq $models.defaultTextVision } | Select-Object -First 1
} else {
    $defaultModel = $models.textVision
}
if (!$defaultModel -or !(Test-Path -LiteralPath (Join-Path $studioRoot $defaultModel.path) -PathType Leaf)) {
    throw 'Falta el modelo local configurado en local-generation/comfyui/models.json.'
}
$dataDirectory = Join-Path $engineRoot 'data'
$webDirectory = Join-Path $engineRoot 'headless-web'
$reportDirectory = Join-Path $studioRoot '.system_generated\reports'
foreach ($directory in @($dataDirectory, $webDirectory, $reportDirectory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
$nodeSource = Join-Path $engineRoot 'kubrick_space'
$nodeDestination = Join-Path $dataDirectory 'custom_nodes\kubrick_space'
New-Item -ItemType Directory -Path $nodeDestination -Force | Out-Null
foreach ($file in @('__init__.py', 'nodes.py', 'tool_protocol.py', 'flux3_pdd.py', 'pdd_math.py', 'h3.py', 'h3_optimization.py', 'h3_upscale.py')) {
    Copy-Item -LiteralPath (Join-Path $nodeSource $file) -Destination (Join-Path $nodeDestination $file) -Force
}
& $pythonExecutable -c 'import jsonschema' 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'Falta una dependencia del paquete Kubrick. Instala requirements-engine.txt en su entorno Python.'
}
$engineArguments = @(
    '"' + (Join-Path $engineDirectory 'main.py') + '"',
    '--listen', '127.0.0.1', '--port', "$Port",
    '--base-directory', '"' + $dataDirectory + '"',
    '--front-end-root', '"' + $webDirectory + '"',
    '--extra-model-paths-config', '"' + (Join-Path $engineRoot 'extra-model-paths.yaml') + '"',
    '--disable-auto-launch', '--disable-all-custom-nodes',
    '--whitelist-custom-nodes', 'kubrick_space', '--offline'
)
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$engineProcess = Start-Process -FilePath $pythonExecutable -ArgumentList $engineArguments -WorkingDirectory $engineDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $reportDirectory "comfyui-$timestamp.out.log") -RedirectStandardError (Join-Path $reportDirectory "comfyui-$timestamp.err.log") -PassThru
[pscustomobject]@{
    Engine = 'ComfyUI'
    Version = $source.version
    ProcessId = $engineProcess.Id
    Address = "http://127.0.0.1:$Port"
}
