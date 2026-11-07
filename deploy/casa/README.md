# Finanzas en tu PC (uso real)

Guía para usar la app con tus finanzas reales corriendo en tu propia PC con Windows. Entras desde el teléfono en cualquier lugar con Tailscale, y los datos quedan guardados en la PC con un respaldo diario.

## Cómo queda armado

- **Copia aparte del repo.** La app corre desde `..\finanzas-casa`, junto a tu repo, con lo último **commiteado** en `main`. Lo que estés probando sin commitear nunca toca tus datos reales.
- **Base separada.** Tiene su propia base de datos, distinta de la de desarrollo (la del puerto 5433). Los datos se guardan en un volumen de Docker y sobreviven a apagados y reinicios.
- **Un solo puerto.** Solo escucha en **`127.0.0.1:47830`**, sin tocar 3000, 3001 ni 5433. Nadie más en tu red ni en internet puede entrar.
- **Tailscale.** Publica ese puerto con HTTPS solo para tus dispositivos. No se abre nada en el router.
- **Respaldos.** Uno por día en la carpeta que elijas, idealmente una sincronizada con OneDrive o Google Drive. Se guardan 30 días.
- **Arranque automático.** Al encender la PC (y entrar a Windows), Docker Desktop arranca y la app con él. Lo que quedó pendiente se pone al día solo: la tasa del día, los recurrentes y las cuotas.

Todos los comandos se corren en **PowerShell, desde la carpeta del repo** (`C:\Users\Froilan\Desktop\Dev\finanzas`).

---

## 1. Requisitos

- **Docker Desktop**, con el motor WSL 2 (el de siempre).
- **Git for Windows** (`git --version` debe responder).

En Docker Desktop, en **Settings → General**, activa **Start Docker Desktop when you sign in to your computer**.

## 2. Instalar y levantar

Asegúrate de tener commiteado en `main` lo que quieres usar. Luego:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\casa\iniciar.ps1
```

La primera vez:

- Crea la copia en `..\finanzas-casa`.
- Pregunta la carpeta de respaldos (por defecto `OneDrive\Respaldos\finanzas`) y, opcionalmente, la clave de Claude para leer facturas.
- Genera la contraseña de la base y los secretos al azar.
- Construye las imágenes. Tarda varios minutos.

Al terminar dice **"Lista. En esta PC: http://localhost:47830"**.

## 3. Crear tu usuario

```powershell
powershell -ExecutionPolicy Bypass -File deploy\casa\crear-usuario.ps1
```

Abre el registro solo mientras crea el usuario y lo vuelve a cerrar.

## 4. Entrar desde el teléfono con Tailscale

1. Instala Tailscale en la PC (<https://tailscale.com/download>) e inicia sesión con Google, Microsoft o GitHub.
2. En la consola de Tailscale, **DNS** (<https://login.tailscale.com/admin/dns>), activa **MagicDNS** y **HTTPS Certificates**.
3. En PowerShell:
   ```powershell
   tailscale serve --bg 47830
   ```
   Te muestra la dirección, algo como `https://nombre-de-tu-pc.tu-red.ts.net`. Queda configurado aunque reinicies. La primera visita puede tardar unos segundos mientras se emite el certificado.
4. En el teléfono, instala la app **Tailscale** con la misma cuenta y conéctala.
5. Abre esa dirección e instala la app:
   - **iPhone:** Safari → Compartir → *Agregar a pantalla de inicio*.
   - **Android:** Chrome → ⋮ → *Instalar app*.

Para entrar, el teléfono necesita Tailscale conectado; puedes dejarlo siempre activo. En la PC usa también la dirección de Tailscale (o `http://localhost:47830`).

Ya dentro: **Ajustes → Categorías → Crear categorías básicas** y crea tus cuentas.

## 5. Que la PC no se duerma

Con la PC suspendida, la app no responde. En PowerShell **como administrador**:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

La pantalla sí se puede apagar sola.

Opcional:

- **Después de un corte de luz:** en la BIOS, la opción *Restore on AC power loss* (o similar) enciende la PC sola cuando vuelve la luz.
- **Arranque sin escribir la contraseña:** Docker Desktop arranca al **iniciar sesión** en Windows. Para que arranque solo, puedes activar el inicio de sesión automático con `netplwiz`. Cualquiera con acceso físico a la PC entraría sin contraseña; decide tú.

## 6. Tu familia

Cada familiar lleva sus finanzas por separado, con su propia cuenta.

1. **Invítalo desde la app.** En **Ajustes → Familia** escribe su nombre, pulsa **Invitar** y mándale el enlace por WhatsApp. Sirve una sola vez y vence en 48 horas.
2. **Dale acceso a tu PC por Tailscale.** En la consola de Tailscale, en **Machines**, abre tu PC, elige **Share** y escribe su correo. Tu familiar instala Tailscale en su teléfono con su propia cuenta y acepta la invitación. Solo puede entrar a tu PC, no al resto de tu red.
3. **Tu familiar abre el enlace y crea su cuenta.** Queda vinculado contigo en **Deudas → Personas**: cuando pagues una compra que comparten (una cena, una compra en Cashea), a esa persona le aparece en su cuenta con su parte y su deuda contigo. Los abonos se ven en las dos cuentas.

Desde **Ajustes → Familia** también puedes enviarle un enlace para una contraseña nueva o desactivar su cuenta.

---

## Uso diario

No hay que hacer nada: si la PC está encendida, la app está disponible.

| Para | Comando |
|---|---|
| Publicar cambios nuevos (commitea en `main` primero) | `powershell -ExecutionPolicy Bypass -File deploy\casa\iniciar.ps1` |
| Respaldo ahora mismo | `powershell -ExecutionPolicy Bypass -File deploy\casa\respaldar.ps1` |
| Ver si está corriendo | `docker compose -p finanzas-casa ps` |
| Ver errores de la API | `docker compose -p finanzas-casa logs api --tail 50` |
| Detenerla un rato | `docker compose -p finanzas-casa stop` |
| Volver a encenderla | `docker compose -p finanzas-casa start` |

## Respaldos

- **Automáticos:** el primero de cada día se hace apenas la app está encendida, como `finanzas-AAAA-MM-DD.sql.gz` en tu carpeta. Se borran los de más de 30 días.
- **Restaurar uno:** sobre una base vacía o para volver atrás. El archivo tiene que estar en la carpeta de respaldos, y **reemplaza todos los datos actuales**.
  ```powershell
  powershell -ExecutionPolicy Bypass -File deploy\casa\restaurar.ps1 finanzas-2026-11-06.sql.gz
  ```
- **PC nueva o servidor:** instala igual que en los pasos 1 y 2 y restaura el último respaldo. Lo mismo sirve si después pasas a Oracle u otro servidor.

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| "running scripts is disabled on this system" | Usa la forma `powershell -ExecutionPolicy Bypass -File ...` de esta guía |
| "Docker Desktop no está corriendo" | Abre Docker Desktop y espera a que diga *Engine running* |
| El puerto 47830 está ocupado | Cambia `PORT=` en `..\finanzas-casa\deploy\casa\.env`, corre `iniciar.ps1` y luego `tailscale serve --bg <nuevo puerto>` |
| El teléfono no abre la dirección | Que Tailscale esté conectado en el teléfono y la PC encendida. En la PC: `tailscale serve status` |
| No guarda la sesión en el teléfono | Entra por la dirección `https://...ts.net`, no por la IP local: la sesión necesita HTTPS |
| Falta la tasa de días en que la PC estuvo apagada | Esos días usan la última tasa guardada; si necesitas la exacta, cárgala en **Tasas** |
