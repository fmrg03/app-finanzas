'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TransactionForm } from '@/components/transaction-form';
import { Button } from '@/components/ui/controls';
import { api } from '@/lib/api';
import type { TxType } from '@/lib/types';

/**
 * Registro rápido: abre directo el formulario con la cuenta y la categoría que más usas.
 * Es la página de los accesos directos (mantener presionado el ícono, o agregarla a la pantalla de inicio).
 */
export default function NuevoPage() {
  const [type, setType] = useState<TxType | null>(null);
  const [saved, setSaved] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tipo');
    setType(t === 'ingreso' ? 'INCOME' : 'EXPENSE');
  }, []);
  const habits = useQuery({
    queryKey: ['habits', type],
    queryFn: () => api<{ accountId: string | null; categoryId: string | null }>(`/transactions/habits?type=${type}`),
    enabled: !!type,
  });

  if (!type || habits.isPending) return <p className="py-16 text-center text-muted">Cargando…</p>;
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{type === 'INCOME' ? 'Nuevo ingreso' : 'Nuevo gasto'}</h1>
      {done ? (
        <section className="mt-6 flex flex-col items-center gap-4 rounded-2xl bg-surface p-8 text-center">
          <CheckCircle2 size={40} className="text-income" />
          <p className="text-lg font-bold">{saved === 1 ? 'Guardado' : `${saved} guardados`}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => setDone(false)}>Registrar otro</Button>
            <Link href="/movimientos" className="inline-flex h-11 items-center rounded-xl px-4 font-semibold text-ink hover:bg-ink/5">Ver movimientos</Link>
          </div>
        </section>
      ) : (
        <div className="mt-4 rounded-2xl bg-surface p-5">
          <TransactionForm
            key={saved}
            initialType={type}
            defaults={habits.data ?? undefined}
            onDone={() => { setSaved((n) => n + 1); setDone(true); }}
          />
        </div>
      )}
    </>
  );
}
