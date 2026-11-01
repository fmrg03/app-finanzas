'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, ErrorNote, Field, Input, Segmented, Select } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useCategories } from '@/lib/queries';
import { RATE_LABEL, type Category, type RateSource, type TxType } from '@/lib/types';

export default function CategoriasPage() {
  const qc = useQueryClient();
  const { data: categories = [], isPending, error } = useCategories();
  const [tab, setTab] = useState<TxType>('EXPENSE');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const seed = useMutation({ mutationFn: () => api('/categories/defaults', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }) });

  const list = categories.filter((c) => c.type === tab);

  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Categorías</h1>
        <Button onClick={() => setEditing('new')}><Plus size={18} /> Nueva categoría</Button>
      </header>
      <p className="mt-1 text-muted">La tasa de cada categoría se preselecciona al registrar un movimiento.</p>

      <div className="mt-6">
        <Segmented label="Tipo" value={tab} onChange={setTab} options={[{ value: 'EXPENSE', label: 'Gastos' }, { value: 'INCOME', label: 'Ingresos' }]} />
      </div>

      <div className="mt-4">
        {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
        {isPending && <p className="py-12 text-center text-muted">Cargando…</p>}
        {!isPending && !categories.length && (
          <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
            <p className="font-semibold">Aún no tienes categorías</p>
            <p className="mt-1 text-sm text-muted">Empieza con un juego básico y ajústalo después.</p>
            <Button className="mt-4" onClick={() => seed.mutate()} disabled={seed.isPending}>Crear categorías básicas</Button>
            {seed.error && <div className="mt-3"><ErrorNote>{seed.error.message}</ErrorNote></div>}
          </div>
        )}
        {!!list.length && (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
            {list.flatMap((c) => [c, ...(c.children ?? [])]).map((c) => (
              <li key={c.id}>
                <button onClick={() => setEditing(c)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas/60">
                  <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className={c.parentId ? 'flex-1 pl-5 text-sm' : 'flex-1 font-semibold'}>{c.name}</span>
                  <span className="text-xs text-muted">{c.defaultRateSource ? `Tasa ${RATE_LABEL[c.defaultRateSource]}` : 'Tasa predeterminada'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Nueva categoría' : 'Editar categoría'}>
        {editing && (
          <CategoryForm category={editing === 'new' ? undefined : editing} type={tab} roots={categories.filter((c) => c.type === tab)} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </>
  );
}

function CategoryForm({ category, type, roots, onDone }: { category?: Category; type: TxType; roots: Category[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const done = () => { qc.invalidateQueries({ queryKey: ['categories'] }); onDone(); };
  const mut = useMutation({
    mutationFn: (body: object) => (category ? api(`/categories/${category.id}`, { method: 'PATCH', json: body }) : api('/categories', { method: 'POST', json: body })),
    onSuccess: done,
    onError: (e) => setError(e.message),
  });
  const del = useMutation({ mutationFn: () => api(`/categories/${category!.id}`, { method: 'DELETE' }), onSuccess: done, onError: (e) => setError(e.message) });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const rate = String(fd.get('defaultRateSource'));
    mut.mutate({
      name: String(fd.get('name')),
      type: category?.type ?? type,
      color: String(fd.get('color')),
      parentId: String(fd.get('parentId')) || null,
      defaultRateSource: rate ? (rate as RateSource) : null,
    });
  }

  const parents = roots.filter((r) => r.id !== category?.id);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex gap-3">
        <Field label="Nombre" className="flex-1"><Input name="name" defaultValue={category?.name} required maxLength={60} autoFocus /></Field>
        <Field label="Color"><input type="color" name="color" defaultValue={category?.color ?? '#1f6f78'} className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1" /></Field>
      </div>
      <Field label="Dentro de" hint="Opcional, para agrupar (por ejemplo Hogar > Internet)">
        <Select name="parentId" defaultValue={category?.parentId ?? ''} disabled={!!category?.children?.length}>
          <option value="">Ninguna (categoría principal)</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Tasa al registrar" hint="Predeterminada usa la de tu perfil">
        <Select name="defaultRateSource" defaultValue={category?.defaultRateSource ?? ''}>
          <option value="">Predeterminada</option>
          <option value="BCV">BCV</option>
          <option value="PARALELO">Paralelo</option>
        </Select>
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-2">
        {category && (
          <Button type="button" variant="danger" onClick={() => confirm('¿Eliminar la categoría? Sus movimientos quedarán sin categoría.') && del.mutate()}>Eliminar</Button>
        )}
        <Button type="submit" disabled={mut.isPending} className="ml-auto">{category ? 'Guardar cambios' : 'Crear categoría'}</Button>
      </div>
    </form>
  );
}
