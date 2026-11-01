'use client';

import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function Dialog({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/30 data-[state=open]:animate-[fade_150ms_ease-out]" />
        <D.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:inset-auto sm:left-1/2 sm:top-[8vh] sm:w-[30rem] sm:-translate-x-1/2 sm:rounded-2xl sm:p-6"
        >
          <div className="mb-5 flex items-center justify-between">
            <D.Title className="text-lg font-bold">{title}</D.Title>
            <D.Close className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink" aria-label="Cerrar">
              <X size={18} />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
