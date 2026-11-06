# Hace un respaldo ahora mismo (además del diario automático) y abre la carpeta.
# Uso:  powershell -ExecutionPolicy Bypass -File deploy\casa\respaldar.ps1
. (Join-Path $PSScriptRoot 'comun.ps1')
Revisar-Docker
Revisar-Copia

Compose @('exec', '-T', 'backup', 'sh', '-c', 'f=/backups/finanzas-$(date +%F-%H%M).sql.gz; pg_dump --no-owner | gzip > $f.tmp && mv $f.tmp $f && echo Respaldo creado: $f')
$carpeta = ((Get-Content $EnvFile | Where-Object { $_ -like 'BACKUP_DIR=*' }) -replace 'BACKUP_DIR=', '') -replace '/', '\'
Write-Host "Carpeta de respaldos: $carpeta"
Invoke-Item $carpeta
