$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodeExecutable = & (Join-Path $projectRoot 'scripts/resolve-node-runtime.ps1') -ProjectRoot $projectRoot
$version = & $nodeExecutable --version
if ($version -notmatch '^v24\.') { throw 'Kubrick Space requiere Node 24 LTS. Instala esa versión o utiliza el runtime local del proyecto.' }
$serverFile = Join-Path $projectRoot 'server.js'
$existing = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  foreach ($listeningPid in ($existing.OwningProcess | Select-Object -Unique)) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$listeningPid"
    $ownsServer = $processInfo.CommandLine -and ($processInfo.CommandLine.Contains($serverFile) -or (
      $processInfo.ExecutablePath -eq $nodeExecutable -and
      $nodeExecutable.StartsWith((Join-Path $projectRoot '.system_generated/runtime'), [StringComparison]::OrdinalIgnoreCase) -and
      $processInfo.CommandLine -match '\sserver\.js\s*$'
    ))
    if (-not $ownsServer) { throw 'El puerto 3001 pertenece a otro proceso. No se ha detenido.' }
    Stop-Process -Id $listeningPid -Force
  }
}
$logDir = Join-Path $projectRoot '.system_generated/reports'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$process = Start-Process -FilePath $nodeExecutable -ArgumentList @(('"' + $serverFile + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log') -PassThru
Set-Content -LiteralPath (Join-Path $projectRoot '.system_generated/server.pid') -Value $process.Id
$ready = $false
Add-Type -AssemblyName System.Net.Http
$healthHandler = [System.Net.Http.HttpClientHandler]::new()
$healthHandler.UseProxy = $false
$healthClient = [System.Net.Http.HttpClient]::new($healthHandler)
$healthClient.Timeout = [TimeSpan]::FromSeconds(2)
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  $process.Refresh()
  if ($process.HasExited) { throw "El servidor terminó al iniciar. Revisa $logDir/server-error.log" }
  $listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    try {
      $response = $healthClient.GetAsync('http://127.0.0.1:3001/api/session').GetAwaiter().GetResult()
      if ($response.StatusCode -eq [System.Net.HttpStatusCode]::OK) { $ready = $true; break }
    } catch { }
  }
  Start-Sleep -Milliseconds 500
}
$healthClient.Dispose()
if (-not $ready) { throw "El servidor aún no responde. Revisa $logDir/server-error.log (PID $($process.Id))." }
Write-Output "Kubrick Space: http://127.0.0.1:3001 (PID $($process.Id), $version)"
