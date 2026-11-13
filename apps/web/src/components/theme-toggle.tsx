'use client';

import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/** Botón de sol/luna para pasar entre claro y oscuro. */
export function ThemeToggle({ className }: { className?: string }) {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={dark ? 'Modo claro' : 'Modo oscuro'}
      className={cn('grid size-9 place-items-center rounded-full text-muted hover:bg-canvas hover:text-ink', className)}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
