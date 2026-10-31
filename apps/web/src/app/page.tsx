export default async function Home() {
  let status = 'sin conexión';
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, { cache: 'no-store' });
    status = res.ok ? 'conectada' : `error ${res.status}`;
  } catch {}
  return (
    <main>
      <h1>Finanzas</h1>
      <p>API: {status}</p>
    </main>
  );
}
