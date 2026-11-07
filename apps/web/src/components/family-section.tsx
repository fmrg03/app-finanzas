'use client';

import { Copy, KeyRound, MessageCircle, Shield, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Button, ErrorNote, Input } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { useApiMutation, useMembers, usePendingInvitations } from '@/lib/planning';
import { shareWhatsApp } from '@/lib/share';
import type { InvitationLink, Member } from '@/lib/types';

const fecha = (iso: string) => new Date(iso).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' });

/** Familia: quién usa la app. El administrador invita, desactiva y restablece contraseñas. */
export function FamilySection({ isAdmin }: { isAdmin: boolean }) {
  const { data: members = [] } = useMembers();
  const { data: pending = [] } = usePendingInvitations(isAdmin);
  const [name, setName] = useState('');
  const [link, setLink] = useState<{ link: InvitationLink; who: string } | null>(null);
  const invite = useApiMutation((b: { name?: string }) => api<InvitationLink>('/family/invitations', { method: 'POST', json: b }), ['family']);
  const reset = useApiMutation((id: string) => api<InvitationLink>(`/family/members/${id}/reset-link`, { method: 'POST' }), ['family']);
  const update = useApiMutation((b: { id: string; disabled?: boolean; role?: 'ADMIN' | 'MEMBER' }) =>
    api<Member>(`/family/members/${b.id}`, { method: 'PATCH', json: { disabled: b.disabled, role: b.role } }), ['family']);
  const revoke = useApiMutation((id: string) => api(`/family/invitations/${id}`, { method: 'DELETE' }), ['family']);
  const error = invite.error ?? reset.error ?? update.error ?? revoke.error;

  return (
    <section aria-labelledby="familia" className="mt-4 rounded-2xl bg-surface p-5">
      <h2 id="familia" className="flex items-center gap-2 font-bold"><Users size={18} className="text-accent" /> Familia</h2>
      <p className="mt-1 text-sm text-muted">
        Cada quien lleva sus finanzas por separado. Lo que compartan (una cena, una compra en Cashea) le aparece al otro en su cuenta.
      </p>

      <ul className="mt-4 divide-y divide-line">
        {members.map((m) => (
          <li key={m.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5', m.disabledAt && 'opacity-60')}>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-semibold">
                {m.displayName}
                {m.me && <span className="text-xs font-normal text-muted">(tú)</span>}
                {m.role === 'ADMIN' && <Shield size={14} className="text-accent" aria-label="Administra" />}
              </p>
              <p className="truncate text-xs text-muted">{m.email}{m.disabledAt ? ', desactivada' : ''}</p>
            </div>
            {isAdmin && !m.me && (
              <div className="flex flex-wrap items-center gap-x-3 text-sm">
                {!m.disabledAt && (
                  <button
                    onClick={async () => setLink({ link: await reset.mutateAsync(m.id), who: m.displayName })}
                    className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
                  >
                    <KeyRound size={14} /> Nueva contraseña
                  </button>
                )}
                <button
                  onClick={() => (m.disabledAt || confirm(`¿Desactivar a ${m.displayName}? No podrá entrar hasta que la reactives. Sus datos se conservan.`)) && update.mutate({ id: m.id, disabled: !m.disabledAt })}
                  className={cn('font-semibold hover:underline', m.disabledAt ? 'text-income' : 'text-muted hover:text-expense')}
                >
                  {m.disabledAt ? 'Reactivar' : 'Desactivar'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {isAdmin && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (opcional)" aria-label="Nombre de quien invitas" className="h-10 min-w-0 flex-1" maxLength={60} />
            <Button
              disabled={invite.isPending}
              onClick={async () => {
                const l = await invite.mutateAsync(name.trim() ? { name: name.trim() } : {});
                setLink({ link: l, who: name.trim() });
                setName('');
              }}
            >
              <UserPlus size={16} /> Invitar
            </Button>
          </div>
          {!!pending.length && (
            <ul className="mt-3 text-sm text-muted">
              {pending.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-1">
                  <span className="flex-1">Invitación {i.name ? `para ${i.name}` : 'sin nombre'}, vence {fecha(i.expiresAt)}</span>
                  <button onClick={() => revoke.mutate(i.id)} className="text-xs hover:text-expense">Anular</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <div className="mt-3"><ErrorNote>{error.message}</ErrorNote></div>}
      {link && <LinkPanel {...link} onClose={() => setLink(null)} />}
    </section>
  );
}

/** El enlace se muestra una sola vez: se copia o se manda por WhatsApp. */
function LinkPanel({ link, who, onClose }: { link: InvitationLink; who: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${link.path}`;
  const hola = who ? `Hola ${who.split(' ')[0]} 👋 ` : 'Hola 👋 ';
  const text = link.kind === 'RESET'
    ? `${hola}Con este enlace puedes poner una contraseña nueva en Finanzas: ${url}\nSirve una sola vez y vence en 48 horas.`
    : `${hola}Te invito a llevar tus finanzas en nuestra app. Crea tu cuenta aquí: ${url}\nEl enlace sirve una sola vez y vence en 48 horas.`;
  return (
    <div className="mt-4 rounded-xl bg-income-soft/60 p-3">
      <p className="text-sm font-semibold">{link.kind === 'RESET' ? `Enlace de nueva contraseña${who ? ` para ${who}` : ''}` : `Invitación${who ? ` para ${who}` : ''}`}</p>
      <p className="mt-1 break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs">{url}</p>
      <p className="mt-1 text-xs text-muted">Solo se muestra ahora. Vence el {fecha(link.expiresAt)}. Para abrirlo, tu familiar necesita acceso a la app (en tu PC: Tailscale).</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button className="h-9" onClick={() => shareWhatsApp(text)}><MessageCircle size={16} /> WhatsApp</Button>
        <Button
          variant="ghost"
          className="h-9"
          onClick={async () => {
            await navigator.clipboard?.writeText(url).catch(() => undefined);
            setCopied(true);
          }}
        >
          <Copy size={16} /> {copied ? 'Copiado' : 'Copiar'}
        </Button>
        <Button variant="ghost" className="ml-auto h-9" onClick={onClose}>Listo</Button>
      </div>
    </div>
  );
}
