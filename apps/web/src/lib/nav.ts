import { ArrowLeftRight, ChartPie, Coins, Goal, HandCoins, LandPlot, Menu, Repeat, Settings, Tags, Target, Wallet } from 'lucide-react';

export const NAV_GROUPS = [
  {
    label: null,
    items: [
      { href: '/resumen', label: 'Resumen', icon: ChartPie },
      { href: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight },
      { href: '/cuentas', label: 'Cuentas', icon: Wallet },
      { href: '/patrimonio', label: 'Patrimonio', icon: LandPlot },
    ],
  },
  {
    label: 'Planificación',
    items: [
      { href: '/presupuestos', label: 'Presupuestos', icon: Target },
      { href: '/recurrentes', label: 'Recurrentes', icon: Repeat },
      { href: '/metas', label: 'Metas de ahorro', icon: Goal },
      { href: '/deudas', label: 'Deudas y cuotas', icon: HandCoins },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { href: '/tasas', label: 'Tasas', icon: Coins },
      { href: '/categorias', label: 'Categorías', icon: Tags },
      { href: '/ajustes', label: 'Ajustes', icon: Settings },
    ],
  },
];

// Barra inferior del móvil: lo de uso diario; el resto vive en "Más"
export const NAV_MOBILE = [
  { href: '/resumen', label: 'Resumen', icon: ChartPie },
  { href: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight },
  { href: '/cuentas', label: 'Cuentas', icon: Wallet },
  { href: '/presupuestos', label: 'Presupuestos', icon: Target },
  { href: '/mas', label: 'Más', icon: Menu },
];
const MOBILE_MAIN = new Set(NAV_MOBILE.map((n) => n.href).filter((h) => h !== '/mas'));
export const isMoreSection = (path: string) => !Array.from(MOBILE_MAIN).some((h) => path.startsWith(h));
