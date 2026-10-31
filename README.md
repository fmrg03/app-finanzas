# Finanzas — gestor de finanzas personales (USD + Bs)

Monorepo pnpm: `apps/api` (NestJS + Prisma), `apps/web` (Next.js), `packages/shared`.

## Requisitos
Node 20+ (recomendado 22 LTS), pnpm 9+, Docker.

## Primer arranque
```bash
cp .env.example .env          # edita los JWT_*_SECRET
pnpm install
pnpm db:up                    # Postgres 16 en Docker
pnpm --filter @finanzas/api prisma:generate
pnpm --filter @finanzas/api prisma:migrate   # nombre sugerido: init
pnpm dev:api                  # http://localhost:3001/api  |  Swagger: /docs
pnpm dev:web                  # http://localhost:3000
```

## Probar la autenticación
```bash
curl -X POST localhost:3001/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"tu@correo.com","password":"una-clave-larga"}'
# usa el accessToken:
curl localhost:3001/api/auth/me -H 'Authorization: Bearer <accessToken>'
```
Tras crear tu usuario, pon `ALLOW_REGISTRATION=false` en `.env`.

## Endpoints de negocio
Todos bajo `/api`, con `Authorization: Bearer <accessToken>`. Detalle y pruebas en Swagger (`/docs`).

| Recurso | Endpoints |
|---|---|
| Cuentas | `GET/POST /accounts`, `GET/PATCH/DELETE /accounts/:id` (el listado trae `balance`) |
| Categorías | `GET/POST /categories`, `POST /categories/defaults`, `GET/PATCH/DELETE /categories/:id` |
| Tasas | `GET /exchange-rates`, `GET /exchange-rates/latest`, `GET /exchange-rates/for-date`, `PUT /exchange-rates`, `POST /exchange-rates/sync` |
| Movimientos | `GET/POST /transactions`, `GET /transactions/tags`, `GET/PATCH/DELETE /transactions/:id` |

Flujo mínimo para cargar el primer gasto:
```bash
T='Authorization: Bearer <accessToken>'; J='Content-Type: application/json'
curl -X POST localhost:3001/api/categories/defaults -H "$T"
curl -X POST localhost:3001/api/accounts -H "$T" -H "$J" -d '{"name":"Efectivo $","type":"CASH","currency":"USD"}'
curl -X POST localhost:3001/api/transactions -H "$T" -H "$J" \
  -d '{"accountId":"<id>","categoryId":"<id>","type":"EXPENSE","date":"2026-10-30","currency":"VES","amount":"1500","rateSource":"BCV"}'
```

## Decisiones
- Guard JWT **global**: todo endpoint nuevo queda protegido salvo que uses `@Public()`.
- Refresh token con rotación; se guarda su hash SHA-256 (un solo dispositivo activo por ahora).
- `Transaction` guarda snapshot: monto original, `amountUsd`, `amountVes`, `rateUsed` y `rateSource`. `rate` = Bs por 1 USD.
- Montos siempre `Decimal`, nunca float. Se envían y reciben como string (`"25.50"`).
- **Tasa de una transacción:** `rate` explícito (queda como `MANUAL`) → `rateSource` pedido → el de la categoría → el del usuario. Si no hay tasa ese día (fin de semana, feriado) se usa la última anterior.
- Editar un movimiento recalcula el snapshot **solo** si cambias monto, moneda, fecha, fuente o tasa. Corregir una tasa en la tabla nunca toca movimientos ya guardados.
- Tasas: DolarApi (`oficial` → BCV, `paralelo`), detrás de la interfaz `RateProvider`. Cron a las 9:00 y 13:00 de Caracas, y sincronización al arrancar si falta la de hoy. Se evita la tarde porque el BCV publica ahí la tasa del día hábil siguiente.
- Una cuenta con movimientos no se borra: se archiva (`PATCH {"archived": true}`).

## Siguientes pasos
1. ~~Módulos: cuentas, categorías, transacciones~~ ✔
2. ~~Módulo `exchange-rates` (cron + proveedores BCV/paralelo + respaldo manual)~~ ✔
3. Frontend (Tailwind, shadcn/ui, login, carga rápida)
4. Dashboard · 5. Facturas por foto · 6. Dockerfiles de api/web y despliegue
