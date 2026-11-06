# Restaura un respaldo SOBRE una base vacía (por ejemplo en una PC nueva). Borra lo que haya.
# Uso:  powershell -ExecutionPolicy Bypass -File deploy\casa\restaurar.ps1 finanzas-2026-11-06.sql.gz
param([Parameter(Mandatory)][string]$Archivo)
. (Join-Path $PSScriptRoot 'comun.ps1')
Revisar-Docker
Revisar-Copia

$nombre = Split-Path $Archivo -Leaf
$carpeta = ((Get-Content $EnvFile | Where-Object { $_ -like 'BACKUP_DIR=*' }) -replace 'BACKUP_DIR=', '') -replace '/', '\'
if (-not (Test-Path (Join-Path $carpeta $nombre))) { throw "El archivo tiene que estar en la carpeta de respaldos: $carpeta" }

Write-Host "Esto BORRA los datos actuales de la app y los reemplaza por $nombre." -ForegroundColor Yellow
if ((Read-Host 'Escribe RESTAURAR para continuar') -ne 'RESTAURAR') { Write-Host 'Cancelado.'; exit 1 }

Compose @('stop', 'api')
Compose @('exec', '-T', 'backup', 'sh', '-c', "psql -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' && gunzip -c /backups/$nombre | psql -q -v ON_ERROR_STOP=1")
Compose @('start', 'api')
Esperar-Api
Write-Host 'Respaldo restaurado.' -ForegroundColor Green
