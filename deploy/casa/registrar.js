// Lo usa crear-usuario.ps1: se ejecuta dentro del contenedor de la API con las credenciales en `c`.
fetch('http://localhost:3001/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: c.email, password: c.password }),
}).then(async (r) => {
  const b = await r.json().catch(() => ({}));
  if (r.ok) console.log('Usuario creado: ' + c.email);
  else console.error('No se pudo crear: ' + (Array.isArray(b.message) ? b.message.join('. ') : b.message || r.status));
  process.exit(r.ok ? 0 : 1);
});
