#!/bin/sh
# Respaldos de Finanzas (corre dentro del contenedor "backup").
#   sh respaldo.sh            -> bucle: un respaldo por día, verificado, y limpieza de los viejos
#   sh respaldo.sh ahora      -> respaldo inmediato y verificado
#   sh respaldo.sh verificar  -> verifica el último respaldo
#
# Verificar = restaurarlo en una base aparte (finanzas_verificacion), contar lo que trae y borrarla.
# El resultado queda en la tabla "BackupCheck" de la app, que avisa en la campanita si algo falla.
set -u
VERIFY_DB=finanzas_verificacion

log() { echo "$(date '+%F %T') $*"; }
sql_str() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

record() { # archivo ok tamaño usuarios cuentas movimientos error
  err=null; [ -n "$7" ] && err=$(sql_str "$7")
  psql -q -v ON_ERROR_STOP=1 -c "INSERT INTO \"BackupCheck\" (id, file, ok, \"sizeBytes\", users, accounts, transactions, error)
    VALUES (md5(random()::text || clock_timestamp()::text), $(sql_str "$1"), $2, $3, $4, $5, $6, $err)" >/dev/null 2>&1 \
    || log "No se pudo anotar el resultado en la base (¿está caída o faltan las migraciones?)"
}

verify() {
  f="$1"; name=$(basename "$f")
  size=$(wc -c < "$f" | tr -d ' ')
  dropdb --if-exists "$VERIFY_DB" >/dev/null 2>&1
  if ! gzip -t "$f" 2>/tmp/verify.err; then
    record "$name" false "$size" null null null "El archivo está dañado: $(head -c 200 /tmp/verify.err)"; log "Verificación FALLÓ: $name dañado"; return 1
  fi
  if createdb "$VERIFY_DB" 2>/tmp/verify.err && gunzip -c "$f" | psql -q -v ON_ERROR_STOP=1 -d "$VERIFY_DB" >/dev/null 2>>/tmp/verify.err; then
    counts=$(psql -tA -F ' ' -d "$VERIFY_DB" -c 'SELECT (SELECT count(*) FROM "User"), (SELECT count(*) FROM "Account"), (SELECT count(*) FROM "Transaction")' 2>>/tmp/verify.err)
    dropdb --if-exists "$VERIFY_DB" >/dev/null 2>&1
    if [ -n "$counts" ]; then
      set -- $counts
      record "$name" true "$size" "$1" "$2" "$3" ""
      log "Verificado: $name ($1 usuarios, $2 cuentas, $3 movimientos)"
      return 0
    fi
  fi
  dropdb --if-exists "$VERIFY_DB" >/dev/null 2>&1
  record "$name" false "$size" null null null "No se pudo restaurar: $(tail -c 300 /tmp/verify.err)"
  log "Verificación FALLÓ: $name"
  return 1
}

backup() { # destino
  # pg_dump comprime él mismo: así, si falla, se nota (con "pg_dump | gzip" manda el código de gzip y queda un archivo vacío)
  if pg_dump --no-owner -Z 6 -f "$1.tmp" && mv "$1.tmp" "$1"; then
    log "Respaldo creado: $1"; verify "$1"
  else
    rm -f "$1.tmp"; log "Falló el respaldo" >&2
    record "$(basename "$1")" false 0 null null null "pg_dump falló: la base no respondió"
    return 1
  fi
}

case "${1:-bucle}" in
  ahora) backup "/backups/finanzas-$(date +%F-%H%M).sql.gz" ;;
  verificar)
    last=$(ls -t /backups/finanzas-*.sql.gz 2>/dev/null | head -n 1)
    [ -z "$last" ] && { log "No hay respaldos en /backups"; exit 1; }
    verify "$last" ;;
  *)
    # Al encender la PC respalda si hoy no hay respaldo; luego revisa cada hora
    while true; do
      f=/backups/finanzas-$(date +%F).sql.gz
      if [ ! -s "$f" ]; then
        backup "$f"
        find /backups -name 'finanzas-*.sql.gz' -mtime +"${KEEP_DAYS:-30}" -delete
      fi
      sleep 3600
    done ;;
esac
