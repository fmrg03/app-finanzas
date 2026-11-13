# Comprueba que el último respaldo sirve: lo restaura en una base aparte, cuenta lo que trae y la borra.
# Los datos de la app no se tocan. El resultado también se ve en Ajustes > Respaldos.
# Uso:  powershell -ExecutionPolicy Bypass -File deploy\casa\verificar-respaldo.ps1
. (Join-Path $PSScriptRoot 'comun.ps1')
Revisar-Docker
Revisar-Copia

Compose @('exec', '-T', 'backup', 'sh', '-c', "tr -d '\r' < /respaldo.sh | sh -s verificar")
