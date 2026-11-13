# Hace un respaldo ahora mismo (además del diario automático) y abre la carpeta.
# Uso:  powershell -ExecutionPolicy Bypass -File deploy\casa\respaldar.ps1
. (Join-Path $PSScriptRoot 'comun.ps1')
Revisar-Docker
Revisar-Copia

# Respalda y lo verifica restaurándolo en una base aparte
Compose @('exec', '-T', 'backup', 'sh', '-c', "tr -d '\r' < /respaldo.sh | sh -s ahora")
$carpeta = ((Get-Content $EnvFile | Where-Object { $_ -like 'BACKUP_DIR=*' }) -replace 'BACKUP_DIR=', '') -replace '/', '\'
Write-Host "Carpeta de respaldos: $carpeta"
Invoke-Item $carpeta
