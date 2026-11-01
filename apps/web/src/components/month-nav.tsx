'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { monthLabel } from '@/lib/format';

export function useMonth() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const now = new Date();
  const isCurrent = month.getMonth() === now.getMonth() && month.getFullYear() === now.getFullYear();
  return { month, isCurrent, shift: (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1)) };
}

export function MonthNav({ month, isCurrent, shift }: ReturnType<typeof useMonth>) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => shift(-1)} className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink" aria-label="Mes anterior">
        <ChevronLeft size={20} />
      </button>
      <span className="sr-only" aria-live="polite">{monthLabel(month)}</span>
      <button onClick={() => shift(1)} disabled={isCurrent} className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink disabled:opacity-30" aria-label="Mes siguiente">
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
