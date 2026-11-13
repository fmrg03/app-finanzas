'use client';

import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'fz-theme';

/** Lee la preferencia guardada en este dispositivo (sistema si no hay o si el navegador no deja). */
export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Aplica el tema: "system" sigue al teléfono o la PC. */
export function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && systemDark());
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1520' : '#16233a');
}

/** Tema actual y cómo cambiarlo; se recuerda en este dispositivo. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const c = readTheme();
    setChoice(c);
    setDark(c === 'dark' || (c === 'system' && systemDark()));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => { if (readTheme() === 'system') { applyTheme('system'); setDark(mq.matches); } };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const set = (c: ThemeChoice) => {
    try { if (c === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, c); } catch { /* sin almacenamiento: solo esta sesión */ }
    applyTheme(c);
    setChoice(c);
    setDark(c === 'dark' || (c === 'system' && systemDark()));
  };
  return { choice, dark, set, toggle: () => set(dark ? 'light' : 'dark') };
}

/** Se ejecuta antes de pintar, para que no aparezca un destello claro al abrir en oscuro. */
export const THEME_BOOT = `try{var t=localStorage.getItem('${KEY}');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}`;
