# Crea tu usuario. Abre el registro solo mientras corre y lo vuelve a cerrar.
# Uso:  powershell -ExecutionPolicy Bypass -File deploy\casa\crear-usuario.ps1
. (Join-Path $PSScriptRoot 'comun.ps1')
Revisar-Docker
Revisar-Copia

$email = Read-Host 'Correo'
$p1 = Texto-Plano (Read-Host 'Contraseña (mínimo 8 caracteres)' -AsSecureString)
$p2 = Texto-Plano (Read-Host 'Repítela' -AsSecureString)
if ($p1 -ne $p2) { throw 'Las contraseñas no coinciden.' }

try {
  Write-Host 'Abriendo el registro un momento...'
  $env:ALLOW_REGISTRATION = 'true'
  Compose @('up', '-d', 'api')
  Remove-Item Env:ALLOW_REGISTRATION
  Esperar-Api

  # Las credenciales viajan por la entrada estándar, no en la línea de comandos
  $datos = @{ email = $email.Trim(); password = $p1 } | ConvertTo-Json -Compress
  $codigo = "const c = $datos;`n" + (Get-Content (Join-Path $PSScriptRoot 'registrar.js') -Raw)
  $OutputEncoding = New-Object Text.UTF8Encoding $false
  $codigo | & docker compose -f $Compose --env-file $EnvFile exec -T api node -
  $ok = ($LASTEXITCODE -eq 0)
} finally {
  if (Test-Path Env:ALLOW_REGISTRATION) { Remove-Item Env:ALLOW_REGISTRATION }
  Write-Host 'Cerrando el registro...'
  Compose @('up', '-d', 'api')
}
if ($ok) { Write-Host 'Listo. Ya puedes entrar con ese correo.' -ForegroundColor Green } else { exit 1 }
