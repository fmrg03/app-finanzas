'use client';

import { useQueryClient } from '@tanstack/react-query';
import { FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { Button, Input, Select } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { useCategories } from '@/lib/queries';
import type { Category, TxType } from '@/lib/types';

const NEW = '__new';
/** Colores para las categorías creadas al vuelo (se pueden cambiar en Categorías). */
const PALETTE = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#10b981', '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16'];

/**
 * Selector de categoría con "+ Nueva categoría…": se crea ahí mismo (suelta o dentro de otra)
 * y queda elegida, sin salir del formulario.
 */
export function CategorySelect({
  type, value, onChange, emptyLabel = 'Sin categoría', className,
}: { type: TxType; value: string; onChange: (id: string) => void; emptyLabel?: string; className?: string }) {
  const { data: all = [] } = useCategories();
  const qc = useQueryClient();
  const cats = all.filter((c) => c.type === type);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const n = name.trim();
    if (!n) return;
    const same = all.flatMap((c) => [c, ...(c.children ?? [])]).find((c) => c.type === type && c.name.toLowerCase() === n.toLowerCase() && (c.parentId ?? '') === parentId);
    if (same) { onChange(same.id); return close(); }
    setBusy(true);
    setError(null);
    try {
      const parent = parentId ? cats.find((c) => c.id === parentId) : undefined;
      const c = await api<Category>('/categories', {
        method: 'POST',
        json: { name: n, type, color: parent?.color ?? PALETTE[all.length % PALETTE.length], ...(parentId ? { parentId } : {}) },
      });
      await qc.invalidateQueries({ queryKey: ['categories'] });
      onChange(c.id);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    setCreating(false); setName(''); setParentId(''); setError(null);
  }

  if (creating) {
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-2">
        <div className="flex gap-2">
          <Input
            autoFocus
            placeholder={type === 'EXPENSE' ? 'Ej. Mascotas' : 'Ej. Ventas'}
            aria-label="Nombre de la categoría nueva"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } if (e.key === 'Escape') close(); }}
            maxLength={60}
            className="h-9 min-w-0 flex-1"
          />
          <Select aria-label="Dentro de" value={parentId} onChange={(e) => setParentId(e.target.value)} className="h-9 w-40">
            <option value="">Principal</option>
            {cats.map((c) => <option key={c.id} value={c.id}>Dentro de {c.name}</option>)}
          </Select>
        </div>
        {error && <p className="text-xs text-expense">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="h-8" onClick={close}>Cancelar</Button>
          <Button type="button" className="h-8" disabled={!name.trim() || busy} onClick={() => void create()}>
            <FolderPlus size={14} /> {busy ? 'Creando…' : 'Crear y usar'}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Select value={value} onChange={(e) => (e.target.value === NEW ? setCreating(true) : onChange(e.target.value))} className={className}>
      <option value="">{emptyLabel}</option>
      {cats.map((c) =>
        c.children?.length ? (
          <optgroup key={c.id} label={c.name}>
            <option value={c.id}>{c.name} (general)</option>
            {c.children.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
          </optgroup>
        ) : (
          <option key={c.id} value={c.id}>{c.name}</option>
        ),
      )}
      <option value={NEW}>+ Nueva categoría…</option>
    </Select>
  );
}
