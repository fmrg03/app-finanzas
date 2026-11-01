'use client';

import { MessageCircle, Share2 } from 'lucide-react';
import { useLatestRates } from '@/lib/queries';
import { shareWhatsApp } from '@/lib/share';
import { cn } from '@/lib/format';

export interface ShareTarget {
  personId: string;
  name: string;
  phone: string | null;
  /** Ej. "te debe $ 30,00" */
  detail: string;
}

/** BCV de hoy, para mostrar en Bs lo que se debe. */
export function useTodayBcv() {
  const { data } = useLatestRates();
  return data?.find((r) => r.source === 'BCV')?.rate ?? null;
}

/** Botones para mandar el detalle por WhatsApp: uno por persona y uno general. */
export function SharePanel({
  targets, build, className, title = 'Compartir por WhatsApp',
}: { targets: ShareTarget[]; build: (to: ShareTarget | null, rate: string | null) => string; className?: string; title?: string }) {
  const rate = useTodayBcv();
  return (
    <div className={cn('rounded-xl bg-income-soft/60 p-3', className)}>
      <p className="flex items-center gap-1.5 text-sm font-semibold"><MessageCircle size={16} className="text-income" /> {title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {targets.map((t) => (
          <button
            key={t.personId}
            type="button"
            onClick={() => shareWhatsApp(build(t, rate), t.phone)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-left text-sm font-semibold hover:bg-white/70"
          >
            {t.name}
            <span className="font-normal text-muted">{t.detail}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => shareWhatsApp(build(null, rate))}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-income hover:bg-surface/60"
        >
          <Share2 size={14} /> Resumen
        </button>
      </div>
      {targets.some((t) => !t.phone) && (
        <p className="mt-2 text-xs text-muted">Sin número guardado se abre WhatsApp para que elijas el chat. Puedes agregarlo en Deudas → Personas.</p>
      )}
    </div>
  );
}
