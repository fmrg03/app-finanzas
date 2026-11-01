import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/format';

type Variant = 'primary' | 'ghost' | 'danger';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  ({ className, variant = 'primary', ...p }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-ink text-white hover:bg-ink/90',
        variant === 'ghost' && 'text-ink hover:bg-ink/5',
        variant === 'danger' && 'text-expense hover:bg-expense-soft',
        className,
      )}
      {...p}
    />
  ),
);
Button.displayName = 'Button';

const field = 'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, className)} {...p} />
));
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(field, 'pr-8', className)} {...p} />
));
Select.displayName = 'Select';

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="text-xs text-expense">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

/** Interruptor de dos o tres opciones (USD/Bs, Egreso/Ingreso). */
export function Segmented<T extends string>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string; tone?: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-canvas p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 rounded-md px-3 text-sm font-semibold text-muted transition-colors',
            value === o.value && cn('bg-surface text-ink shadow-[0_1px_2px_rgb(22_35_58/0.12)]', o.tone),
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-lg bg-expense-soft px-3 py-2 text-sm text-expense">{children}</p>;
}
