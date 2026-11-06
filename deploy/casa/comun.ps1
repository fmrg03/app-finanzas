# Funciones compartidas por los scripts de deploy\casa. No se ejecuta solo.
$ErrorActionPreference = 'Stop'

# Repo de desarrollo (donde está este script) y copia aparte de la que corre la app
$script:Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:Copia = Join-Path (Split-Path $script:Repo -Parent) 'finanzas-casa'
$script:Compose = Join-Path $script:Copia 'deploy\casa\docker-compose.yml'
$script:EnvFile = Join-Path $script:Copia 'deploy\casa\.env'

function Ejecutar {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$Argumentos)
  & $Exe @Argumentos
  if ($LASTEXITCODE -ne 0) { throw "Falló: $Exe $($Argumentos -join ' ')" }
}

# Corre un comando externo sin mostrar su salida y devuelve el código de salida.
# En Windows PowerShell 5.1, silenciar los errores de un programa con 'Stop' activo los vuelve excepciones.
function Callado {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$Argumentos)
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Exe @Argumentos *> $null; return $LASTEXITCODE } finally { $ErrorActionPreference = $antes }
}

function Compose {
  param([string[]]$Argumentos)
  Ejecutar docker (@('compose', '-f', $script:Compose, '--env-file', $script:EnvFile) + $Argumentos)
}

function Revisar-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'No encuentro Docker. Instala Docker Desktop.' }
  if ((Callado docker @('info')) -ne 0) { throw 'Docker Desktop no está corriendo. Ábrelo, espera a que diga "Engine running" y vuelve a intentar.' }
}

function Revisar-Copia {
  if (-not (Test-Path $script:EnvFile)) { throw 'La app todavía no está instalada. Corre primero deploy\casa\iniciar.ps1' }
}

# Espera a que la API responda (hasta 3 minutos)
function Esperar-Api {
  Write-Host 'Esperando a que la API arranque...'
  for ($i = 0; $i -lt 90; $i++) {
    $codigo = Callado docker @('compose', '-f', $script:Compose, '--env-file', $script:EnvFile, 'exec', '-T', 'api', 'node', '-e',
      "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))")
    if ($codigo -eq 0) { return }
    Start-Sleep -Seconds 2
  }
  throw 'La API no respondió. Revisa con: docker compose -p finanzas-casa logs api --tail 50'
}

function Nuevo-Secreto([int]$Bytes) {
  $b = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  ($b | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Texto-Plano([Security.SecureString]$Seguro) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Seguro)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
