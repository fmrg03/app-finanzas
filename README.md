# Finanzas: gestor de finanzas personales (USD + Bs)

Registro de ingresos y gastos en dólares y bolívares, con la tasa del día guardada en cada movimiento: transferencias y cambio de divisas, presupuestos, recurrentes, metas, deudas, patrimonio, gráficos y lectura de facturas por foto. Se instala en el teléfono como una app.

Monorepo pnpm: `apps/api` (NestJS + Prisma + PostgreSQL), `apps/web` (Next.js + Tailwind + Recharts) y `packages/shared`.

## Requisitos
Node 20+ (recomendado 22 LTS), pnpm 9 (`npm install -g pnpm@9.15.0`) y Docker Desktop.

## Arranque local
```bash
cp .env.example .env          # edita los JWT_*_SECRET
pnpm install                  # también genera el cliente de Prisma
pnpm db:up                    # Postgres 16 en Docker (puerto 5433)
pnpm --filter @finanzas/api prisma:migrate
pnpm dev:api                  # http://localhost:3001/api  |  Swagger: /docs
pnpm dev:web                  # http://localhost:3000
```

Al actualizar desde una versión anterior: `pnpm install` y `pnpm --filter @finanzas/api prisma:migrate` para aplicar las migraciones nuevas. Si Prisma te pide un nombre para crear otra migración, acéptalo con cualquier nombre: solo ajusta detalles del esquema, sin tocar datos.

Primera vez: crea tu usuario con `POST /auth/register` desde Swagger y luego pon `ALLOW_REGISTRATION=false` en `.env`. En la web, ve a **Ajustes → Categorías → Crear categorías básicas** y crea al menos una cuenta.

### Datos de demostración
```bash
pnpm --filter @finanzas/api seed:demo            # crea el usuario demo con 6 meses de movimientos
pnpm --filter @finanzas/api seed:demo --borrar   # lo borra todo
```
Entra con `demo@finanzas.local` / `demo-clave-123`. Tu usuario no se toca. Para que los movimientos pasados tengan tasa, el script inventa tasas creíbles solo en los días que no tienen una real; `--borrar` también las elimina.

### Instalarla en el teléfono
Con la app publicada en tu dominio (HTTPS):
- **iPhone:** ábrela en Safari → botón Compartir → *Agregar a pantalla de inicio*.
- **Android:** en Chrome → menú ⋮ → *Instalar app*. Manteniendo presionado el ícono aparece el atajo *Nuevo movimiento*.

### Facturas por foto (opcional)
Agrega una clave de la API de Claude en `.env` y reinicia la API:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Aparece el botón **Leer factura** al crear un movimiento. Usa `claude-haiku-5-5` por defecto (configurable con `RECEIPTS_MODEL`), que cuesta muy poco por factura. Sin la clave, la app funciona igual pero sin ese botón.

## Qué hace

| Sección | Qué incluye |
|---|---|
| Resumen | Gasto del mes contra el mes anterior al mismo día, ingresos, gastos y balance, presupuestos más comprometidos, gasto por categoría y los últimos 6 meses, en USD o Bs |
| Movimientos | Gastos, ingresos y transferencias por día, con filtros, búsqueda, conversión en vivo, lectura de facturas y descarga en Excel. Un gasto puede ser **compartido** (por partes iguales, % o montos) o **en cuotas** (Cashea y similares), o ambas cosas |
| Transferencias | Entre cuentas propias, con comisión. Si cambian de moneda, guarda la tasa que te dieron y la compara con la BCV |
| Cuentas | Saldo de cada cuenta en su moneda, archivar |
| Patrimonio | Total en USD mes a mes y cuánto valor perdieron los bolívares que tenías guardados |
| Presupuestos | Tope mensual en USD por categoría, con alerta al 80 % y proyección a fin de mes |
| Recurrentes | Sueldo, servicios y suscripciones: automáticos o con confirmación del monto de cada mes |
| Metas | Objetivo en USD, aportes y retiros, aporte mensual propuesto (o el necesario para llegar a tiempo) y cuánto llevas este mes |
| Familia | Cada familiar con su cuenta y sus finanzas por separado. Invitación por enlace de un solo uso, nueva contraseña por enlace y cuentas desactivables. Las compras compartidas entre familiares aparecen en la cuenta del otro |
| Deudas y cuotas | Lo que debes y te deben (con abonos que entran o salen de una cuenta), compras en cuotas con su calendario y pago de cada cuota, y personas con su WhatsApp para mandar el detalle o recordar lo pendiente |
| Notificaciones | Campanita con avisos: cuando te queda el 5 % de un presupuesto y cuando te pasas, recurrentes por confirmar, deudas vencidas, cuotas que vencen en 2 días o ya vencidas, y en metas: fecha cerca (30 y 7 días), aporte del mes atrasado, mes sin cumplir, fecha vencida sin llegar y meta cumplida. Aviso emergente en el momento en que ocurre |
| Tasas | BCV y paralelo del día, historial por mes, carga o corrección manual |
| Ajustes | Moneda y tasa predeterminadas, categorías, cambio de contraseña |

## Endpoints
Todos bajo `/api` con `Authorization: Bearer <accessToken>`. Login y refresh dejan el refresh token en la cookie `fz_refresh` (httpOnly). El detalle está en Swagger (`/docs`, solo fuera de producción).

| Recurso | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/login`, `/refresh`, `/logout`, `/change-password`, `GET/PATCH /auth/me` |
| Cuentas | `GET/POST /accounts`, `GET/PATCH/DELETE /accounts/:id` |
| Categorías | `GET/POST /categories`, `POST /categories/defaults`, `GET/PATCH/DELETE /categories/:id` |
| Tasas | `GET /exchange-rates`, `/latest`, `/for-date`, `PUT /exchange-rates`, `POST /exchange-rates/sync` |
| Movimientos | `GET/POST /transactions`, `GET /transactions/tags`, `GET/PATCH/DELETE /transactions/:id` |
| Transferencias | `GET/POST /transfers`, `GET/PATCH/DELETE /transfers/:id` |
| Recurrentes | `GET/POST /recurring`, `GET /recurring/due`, `PATCH/DELETE /recurring/:id`, `POST /recurring/:id/confirm`, `POST /recurring/:id/skip` |
| Presupuestos | `GET /budgets?month`, `PUT /budgets`, `DELETE /budgets/:id` |
| Metas | `GET/POST /goals`, `PATCH/DELETE /goals/:id`, `POST /goals/:id/contributions`, `DELETE /goals/:id/contributions/:cid` |
| Deudas | `GET/POST /debts`, `PATCH/DELETE /debts/:id`, `POST /debts/:id/payments`, `DELETE /debts/:id/payments/:pid` |
| Resumen | `GET /stats/overview?from&to&months`, `GET /stats/net-worth?months` |
| Excel | `GET /transactions/export` (mismos filtros que el listado) |
| Personas | `GET/POST /people`, `PATCH/DELETE /people/:id` |
| Compartidos | `POST /shared-expenses`, `GET/PUT /shared-expenses/:id` (id del movimiento; se borra con `DELETE /transactions/:id`) |
| Cuotas | `GET/POST /installment-plans`, `GET /installment-plans/upcoming?days`, `GET/PATCH/DELETE /installment-plans/:id`, `POST/DELETE /installments/:id/pay` |
| Familia | `GET /family/members`, `PATCH /family/members/:id`, `POST /family/members/:id/reset-link`, `GET/POST /family/invitations`, `DELETE /family/invitations/:id` (solo administrador, salvo el listado); públicos: `GET /auth/invitations/:token`, `POST /auth/invitations/:token/accept` |
| Notificaciones | `GET /notifications`, `POST /notifications/read-all`, `POST /notifications/:id/read`, `DELETE /notifications/:id` |
| Facturas | `GET /receipts/status`, `POST /receipts` (multipart `file`), `POST /receipts/:id/confirm`, `GET /receipts/:id/file` |

## Decisiones
- Guard JWT **global**: todo endpoint nuevo queda protegido salvo que uses `@Public()`. Login, registro y cambio de contraseña tienen límite de intentos por minuto.
- Sesión: el access token (15 min) vive solo en memoria del navegador; el refresh token va en una cookie httpOnly, `SameSite=Lax`, limitada a `/api/auth` y `Secure` en producción. Rota en cada uso y se guarda su hash SHA-256. Cambiar la contraseña cierra las demás sesiones.
- `Transaction` guarda un snapshot: monto original, `amountUsd`, `amountVes`, `rateUsed` y `rateSource`. `rate` = Bs por 1 USD.
- Montos siempre `Decimal`, nunca float. Se envían y reciben como string (`"25.50"`).
- **Tasa de un movimiento:** `rate` explícito (queda como `MANUAL`) → `rateSource` pedido → el de la categoría → el del usuario. Si no hay tasa ese día (fin de semana, feriado) se usa la última anterior.
- Editar un movimiento recalcula el snapshot **solo** si cambias monto, moneda, fecha, fuente o tasa. Corregir una tasa en la tabla nunca toca movimientos ya guardados.
- Tasas: DolarApi (`oficial` → BCV, `paralelo`), detrás de la interfaz `RateProvider`. Cron a las 9:00 y 13:00 de Caracas y sincronización al arrancar si falta la de hoy. Se evita la tarde porque el BCV publica ahí la tasa del día hábil siguiente.
- Facturas: la API detecta el tipo de archivo por su firma (JPG, PNG, WEBP o PDF, hasta 10 MB), guarda el archivo, y Claude devuelve un JSON con esquema fijo que la API valida antes de usarlo. Nada se guarda como movimiento hasta que confirmas. La misma foto no se lee dos veces ni se registra dos veces. Si la factura trae la tasa impresa, se propone esa tasa.
- Una cuenta con movimientos o transferencias no se borra: se archiva.
- Las transferencias no son ingreso ni gasto: mueven saldo entre cuentas y no aparecen en los totales del mes.
- Recurrentes: cada ocurrencia se registra con `externalId = rec:<id>:<fecha>`, así nunca se duplica aunque el proceso corra dos veces. Si la API estuvo apagada, al arrancar registra lo atrasado (hasta 24 ocurrencias).
- Notificaciones: la API revisa las condiciones cada vez que se consultan (la web lo hace al abrir, cada minuto y después de cada cambio) y guarda cada aviso con una clave única, así nunca se repite. Un presupuesto avisa una vez por mes al quedar el 5 % (`BUDGET_NEAR_REMAINING_PCT`) y otra al pasarse; si cambias el tope, vuelve a avisar sobre el nuevo monto.
- Alertas de metas: el plan de cada mes es el aporte mensual que pusiste o, si no pusiste, lo necesario para llegar a la fecha. Desde el día 20 (`GOAL_REMINDER_DAY`) avisa si vas atrasado en el mes, y al empezar el mes siguiente avisa si no se cumplió (solo si la meta existía el mes completo). La fecha avisa a 30 y 7 días (`GOAL_DEADLINE_DAYS`) y, si pasa sin llegar, una última vez sugiriendo mover la fecha o ajustar el objetivo. Una meta cumplida no recibe más alertas.
- **Compartidos:** tu gasto es solo tu parte (`myAmountUsd/myAmountVes`), y eso es lo que cuentan el resumen, los presupuestos y los totales; el saldo de la cuenta sí refleja el monto completo que salió. Si pagaste tú, cada persona te debe su parte; si pagó otra, tú le debes la tuya y tus cuentas no se tocan. Las deudas se fijan en USD con la tasa del día de la compra. Los centavos que sobran al repartir los pone quien pagó. Si alguien ya abonó, el reparto no se puede rehacer ni borrar sin quitar antes esos abonos.
- **Familia:** el primer usuario es el administrador. El registro abierto sigue cerrado (`ALLOW_REGISTRATION=false`): los familiares entran con un enlace de invitación que sirve una vez y vence en 48 horas (`INVITATION_TTL_HOURS`), y se guarda solo su hash. Al aceptarlo, la persona queda con las categorías básicas y vinculada en Personas con quien la invitó. Una cuenta desactivada deja de funcionar en la siguiente petición. Al iniciar sesión se borra lo que mostraba la sesión anterior, por si varios familiares usan el mismo equipo.
- **Compras compartidas entre familiares:** una persona vinculada a un usuario recibe una copia de solo lectura de lo que pagaste y compartiste con ella. La copia incluye su parte como gasto (sin tocar sus cuentas), su deuda contigo y, en cuotas, su parte de cada cuota en su fecha. Las dos deudas quedan enlazadas y cada abono aparece en ambas; quien lo recibe elige a qué cuenta entró. La compra la registra quien pagó: si pagó un familiar que usa la app, la API lo rechaza y le toca registrarla a él, para que no quede duplicada. Si editas o borras el original, la copia se rehace o se borra.
- **Abonos de deudas:** pueden entrar o salir de una cuenta (mueven su saldo, no son ingreso ni gasto). Si la cuenta es de otra moneda se convierten con la BCV del día o la tasa que indiques.
- **Compras en cuotas:** el total se fija en USD el día de la compra. La inicial cuenta como gasto ese día y cada cuota el día que la pagas (no el de la compra), con la tasa de ese día. Cuotas iguales a centavos; la última absorbe la diferencia. Si la compra es compartida, solo tu porcentaje de cada pago cuenta como gasto. Si la compra la hizo otra persona, tu parte de cada cuota se registra sola en su fecha (al arrancar la API, a las 00:05 y 06:05 de Caracas y al abrir Cuotas), sin tocar tus cuentas.
- Presupuestos y metas van en USD: en Bs se desactualizarían solos con la devaluación.
- Patrimonio y devaluación: los saldos en Bs se convierten con la BCV de cada fecha. La pérdida por devaluación de un mes es lo que valían en USD los Bs del inicio del mes menos lo que valen al cierre (aproximación que ignora los movimientos dentro del mes).

## Usarla en tu propia PC
Para usar la app con tus datos reales en tu PC con Windows, separada del entorno de desarrollo (puerto 47830) y con acceso desde el teléfono por Tailscale, sigue [`deploy/casa/README.md`](deploy/casa/README.md).

## Despliegue en un servidor con dominio
Todo corre con Docker Compose: Postgres, API, web y Caddy, que obtiene el certificado HTTPS solo. La web y la API quedan en el mismo dominio (`/api/*` va a la API).

1. Un VPS con Docker (1 GB de RAM alcanza) y un registro DNS **A** de tu dominio apuntando a su IP. Puertos 80 y 443 abiertos.
2. En el servidor:
   ```bash
   git clone <tu-repo> finanzas && cd finanzas
   cp deploy/env.production.example deploy/.env
   nano deploy/.env                     # dominio, contraseña de BD, secretos JWT, clave de Claude
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
   ```
   La API aplica las migraciones sola al arrancar.
3. Crea tu usuario: pon `ALLOW_REGISTRATION=true` en `deploy/.env`, repite el `up -d`, regístrate con
   ```bash
   curl -X POST https://tu-dominio/api/auth/register -H 'Content-Type: application/json' \
     -d '{"email":"tu@correo.com","password":"una-clave-larga"}'
   ```
   y vuelve a poner `false` (otro `up -d`).
4. Actualizar: `git pull` y el mismo `docker compose ... up -d --build`.

### Respaldos
El servicio `backup` guarda un respaldo comprimido de la base cada día en el volumen `finanzas_backups` y conserva los últimos 14 (`BACKUP_KEEP_DAYS`). Para bajar uno a tu equipo o restaurarlo:
```bash
C="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env"
$C exec backup ls -lh /backups                                     # ver los respaldos
$C cp backup:/backups/finanzas-2026-10-31.sql.gz .                  # copiarlo fuera del servidor
gunzip -c finanzas-2026-10-31.sql.gz | $C exec -T db psql -U finanzas finanzas   # restaurar (sobre una base vacía)
```
Guarda copias fuera del servidor de vez en cuando. Las fotos de facturas están en el volumen `finanzas_uploads`.

## Pendiente
- Tasas históricas: se guardan desde que la app empezó a correr. Para fechas anteriores, carga la tasa en **Tasas** o usa una tasa manual en el movimiento.
- Una compra en cuotas guarda la inicial y las cuotas con el monto con que se creó: para cambiar el total o el número de cuotas, se elimina y se registra de nuevo.
- Siguiente fase: registro automático de pagos con Apple Pay (Atajos del iPhone) e importación de estados de cuenta del banco.
