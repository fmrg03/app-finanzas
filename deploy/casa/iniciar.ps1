# Instala o actualiza Finanzas en esta PC con lo último COMMITEADO en main, y la deja corriendo.
# Uso (desde la carpeta del repo):
#   powershell -ExecutionPolicy Bypass -File deploy\casa\iniciar.ps1
. (Join-Path $PSScriptRoot 'comun.ps1')

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'No encuentro git en el PATH.' }
Revisar-Docker

# 1. Copia aparte del repo con main: lo que estés probando sin commitear no llega a tus datos reales
if (-not (Test-Path $Copia)) {
  Write-Host "Creando la copia de uso real en $Copia"
  Ejecutar git @('-C', $Repo, 'worktree', 'add', '--detach', $Copia, 'main')
} else {
  Write-Host 'Actualizando la copia de uso real con lo último de main'
  Ejecutar git @('-C', $Copia, 'checkout', '--detach', 'main')
}
$commit = (& git -C $Copia log -1 --format='%h %s')
Write-Host "Versión: $commit"

# 2. Configuración: la primera vez se crea con secretos al azar
if (-not (Test-Path $EnvFile)) {
  $porDefecto = if ($env:OneDrive) { Join-Path $env:OneDrive 'Respaldos\finanzas' } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Respaldos\finanzas' }
  Write-Host ''
  Write-Host 'Carpeta para los respaldos diarios. Lo ideal es una que se sincronice con OneDrive o Google Drive.'
  $resp = Read-Host "Carpeta (Enter para $porDefecto)"
  $carpeta = if ([string]::IsNullOrWhiteSpace($resp)) { $porDefecto } else { $resp.Trim('" ') }
  New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
  $claude = Read-Host 'Clave de la API de Claude para leer facturas (Enter para omitir)'

  $lineas = @(
    'POSTGRES_USER=finanzas',
    "POSTGRES_PASSWORD=$(Nuevo-Secreto 24)",
    'POSTGRES_DB=finanzas',
    "JWT_ACCESS_SECRET=$(Nuevo-Secreto 48)",
    "JWT_REFRESH_SECRET=$(Nuevo-Secreto 48)",
    "BACKUP_DIR=$((Resolve-Path $carpeta).Path -replace '\\', '/')",
    'BACKUP_KEEP_DAYS=30',
    'PORT=47830',
    "ANTHROPIC_API_KEY=$claude"
  )
  [IO.File]::WriteAllLines($EnvFile, $lineas, (New-Object Text.UTF8Encoding $false))
  Write-Host "Configuración guardada en $EnvFile"
}

# 3. Construir y levantar (la primera vez tarda varios minutos)
Compose @('up', '-d', '--build', '--remove-orphans')
Callado docker @('image', 'prune', '-f') | Out-Null
Esperar-Api

$puerto = ((Get-Content $EnvFile | Where-Object { $_ -like 'PORT=*' }) -replace 'PORT=', '')
if (-not $puerto) { $puerto = '47830' }
Write-Host ''
Write-Host "Lista. En esta PC: http://localhost:$puerto" -ForegroundColor Green
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
  Write-Host 'Desde el teléfono, con Tailscale:' -NoNewline
  & tailscale serve status
} else {
  Write-Host 'Para entrar desde el teléfono, instala Tailscale (ver deploy\casa\README.md).'
}
