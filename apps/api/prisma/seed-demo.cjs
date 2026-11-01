/**
 * Datos ficticios para ver la app con contenido.
 *
 *   pnpm --filter @finanzas/api seed:demo            crea (o recrea) el usuario demo
 *   pnpm --filter @finanzas/api seed:demo --borrar   borra el usuario demo y las tasas inventadas
 *
 * Entra con demo@finanzas.local / demo-clave-123. Tu usuario real no se toca.
 * Las tasas inventadas solo rellenan días que no tienen tasa real y se marcan
 * con fetchedAt = 2000-01-01 para poder borrarlas sin tocar las reales.
 */
const { PrismaClient, Prisma } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const EMAIL = 'demo@finanzas.local';
const PASSWORD = 'demo-clave-123';
const MONTHS = 6; // el actual y 5 hacia atrás, para llenar el gráfico de 6 meses
const DEMO_MARK = new Date('2000-01-01T00:00:00Z');
const TZ = process.env.APP_TIMEZONE || 'America/Caracas';

const D = Prisma.Decimal;
const prisma = new PrismaClient();

// Aleatorio con semilla: los datos salen iguales en cada ejecución
let seed = 20261031;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a, b) => a + rnd() * (b - a);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const today = new Date(`${todayStr}T00:00:00Z`);
const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);

async function borrar() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (user) {
    // Primero lo que apunta a cuentas y personas: no se pueden borrar mientras algo las use
    await prisma.installmentPlan.deleteMany({ where: { userId: user.id } });
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.transfer.deleteMany({ where: { userId: user.id } });
    await prisma.debt.deleteMany({ where: { userId: user.id } });
    await prisma.sharedExpense.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  const { count } = await prisma.exchangeRate.deleteMany({ where: { fetchedAt: DEMO_MARK } });
  console.log(`Usuario demo ${user ? 'borrado' : 'no existía'}. Tasas inventadas borradas: ${count}.`);
}

/** Rellena los días sin tasa con valores creíbles que suben poco a poco hasta la tasa real más reciente. */
async function rellenarTasas(desde) {
  const anchor = async (source, fallback) =>
    (await prisma.exchangeRate.findFirst({ where: { source, fetchedAt: { not: DEMO_MARK } }, orderBy: { date: 'desc' } }))?.rate ??
    new D(fallback);
  const bcv = Number(await anchor('BCV', 215.45));
  const par = Number(await anchor('PARALELO', 268.1));
  const rows = [];
  for (let d = new Date(desde), i = Math.round((today - desde) / DAY); d <= today; d = addDays(d, 1), i--) {
    // ~0,17 % diario de devaluación hacia atrás desde la tasa actual
    const f = Math.pow(1 - 0.0017, i);
    rows.push({ date: d, source: 'BCV', rate: (bcv * f).toFixed(4), fetchedAt: DEMO_MARK });
    rows.push({ date: d, source: 'PARALELO', rate: (par * f * between(0.995, 1.005)).toFixed(4), fetchedAt: DEMO_MARK });
  }
  const { count } = await prisma.exchangeRate.createMany({ data: rows, skipDuplicates: true });
  return count;
}

async function crear() {
  await borrar();
  const desde = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (MONTHS - 1), 1));
  const tasasNuevas = await rellenarTasas(desde);

  const rates = await prisma.exchangeRate.findMany({ where: { date: { gte: desde, lte: today } } });
  // Tasa del día o, si no hay (por ejemplo un día futuro que luego se descarta), la última anterior
  const rateOf = (date, source) => {
    const own = rates.filter((r) => r.source === source).sort((a, b) => a.date - b.date);
    return (own.findLast((r) => r.date <= date) ?? own[0]).rate;
  };

  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 12), defaultCurrency: 'USD', defaultRateSource: 'BCV' },
  });
  const userId = user.id;

  const cat = {};
  const defs = [
    ['Sueldo', 'INCOME', '#16a34a'], ['Trabajos extra', 'INCOME', '#22c55e'], ['Otros ingresos', 'INCOME', '#4ade80'],
    ['Supermercado', 'EXPENSE', '#ea580c'], ['Comida fuera', 'EXPENSE', '#f97316', 'PARALELO'], ['Transporte', 'EXPENSE', '#0ea5e9'],
    ['Servicios', 'EXPENSE', '#6366f1'], ['Salud', 'EXPENSE', '#e11d48'], ['Hogar', 'EXPENSE', '#a16207'],
    ['Entretenimiento', 'EXPENSE', '#a855f7', 'PARALELO'], ['Otros gastos', 'EXPENSE', '#64748b'],
  ];
  for (const [name, type, color, defaultRateSource] of defs) {
    cat[name] = await prisma.category.create({ data: { userId, name, type, color, defaultRateSource: defaultRateSource ?? null } });
  }
  for (const [name, parent, color] of [['Internet', 'Servicios', '#818cf8'], ['Luz y agua', 'Servicios', '#a5b4fc'], ['Farmacia', 'Salud', '#fb7185']]) {
    cat[name] = await prisma.category.create({ data: { userId, name, type: cat[parent].type, color, parentId: cat[parent].id } });
  }

  const acc = {
    cash: await prisma.account.create({ data: { userId, name: 'Efectivo $', type: 'CASH', currency: 'USD', initialBalance: '180' } }),
    bank: await prisma.account.create({ data: { userId, name: 'Banesco', type: 'BANK', currency: 'VES', initialBalance: '12500' } }),
    zinli: await prisma.account.create({ data: { userId, name: 'Zinli', type: 'WALLET', currency: 'USD', initialBalance: '40' } }),
    card: await prisma.account.create({ data: { userId, name: 'Tarjeta de crédito Mercantil', type: 'CARD', currency: 'VES' } }),
  };

  // Recurrentes: el sueldo y Netflix se registran solos; internet y luz se confirman cada mes
  const rec = {};
  const mkRec = async (key, data) => (rec[key] = await prisma.recurring.create({ data: { userId, tags: ['mensual'], frequency: 'MONTHLY', ...data } }));
  const monthDay = (n, shift = 0) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + shift, n));
  const nextFor = (n) => (monthDay(n) > today ? monthDay(n) : monthDay(n, 1));
  await mkRec('sueldo', { type: 'INCOME', accountId: acc.zinli.id, categoryId: cat['Sueldo'].id, currency: 'USD', amount: '900', description: 'Sueldo', startDate: desde, nextDate: nextFor(1), autoCreate: true });
  await mkRec('netflix', { type: 'EXPENSE', accountId: acc.zinli.id, categoryId: cat['Entretenimiento'].id, currency: 'USD', amount: '10.99', description: 'Netflix', startDate: addDays(desde, 7), nextDate: nextFor(8), autoCreate: true });
  await mkRec('luz', { type: 'EXPENSE', accountId: acc.bank.id, categoryId: cat['Luz y agua'].id, currency: 'VES', amount: '1700', description: 'Corpoelec e Hidrocapital', startDate: addDays(desde, 4), nextDate: nextFor(5) });
  // El internet de este mes queda pendiente de confirmar, para ver el aviso
  await mkRec('internet', { type: 'EXPENSE', accountId: acc.bank.id, categoryId: cat['Internet'].id, currency: 'VES', amount: '5200', description: 'Inter fibra 200 Mb', startDate: addDays(desde, 2), nextDate: monthDay(3) <= today ? monthDay(3) : monthDay(3, -1) });

  const txs = [];
  /** Igual que la API: snapshot USD/Bs con la tasa del día, redondeo a 2 decimales. */
  function tx(date, type, category, account, currency, amount, description, tags = [], recKey) {
    if (date > today) return;
    const source = cat[category].defaultRateSource ?? 'BCV';
    const rate = rateOf(date, source);
    const a = new D(amount).toDecimalPlaces(2);
    const usd = currency === 'USD' ? a : a.div(rate).toDecimalPlaces(2, D.ROUND_HALF_UP);
    const ves = currency === 'VES' ? a : a.mul(rate).toDecimalPlaces(2, D.ROUND_HALF_UP);
    txs.push({
      userId, accountId: account.id, categoryId: cat[category].id, type, date, description, tags,
      originalCurrency: currency, originalAmount: a, amountUsd: usd, amountVes: ves, rateUsed: rate, rateSource: source,
      myAmountUsd: usd, myAmountVes: ves,
      // Los generados por un recurrente llevan su marca, igual que los de la API
      ...(recKey ? { source: 'RECURRING', externalId: `rec:${rec[recKey].id}:${iso(date)}` } : {}),
    });
  }
  const transfers = [];
  /** Transferencia entre cuentas; si cambia de moneda guarda la tasa obtenida y la BCV del día. */
  function transfer(date, from, to, fromAmount, toAmount, description) {
    if (date > today) return;
    const fx = from.currency !== to.currency;
    const usd = from.currency === 'USD' ? fromAmount : toAmount;
    const vesAmt = from.currency === 'USD' ? toAmount : fromAmount;
    transfers.push({
      userId, date, fromAccountId: from.id, toAccountId: to.id, fromAmount: new D(fromAmount).toDecimalPlaces(2), toAmount: new D(toAmount).toDecimalPlaces(2),
      rate: fx ? new D(vesAmt).div(usd).toDecimalPlaces(6) : null, referenceRate: fx ? rateOf(date, 'BCV') : null, description,
    });
  }
  const bs = (usd, date, source = 'BCV') => Number(new D(usd).mul(rateOf(date, source)).toFixed(2));

  for (let m = 0; m < MONTHS; m++) {
    const first = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth() + m, 1));
    const day = (n) => addDays(first, n - 1);
    const isLast2 = m >= MONTHS - 2; // el mes anterior y el actual van más detallados

    // El sueldo entra completo a Zinli; de ahí se retira efectivo y se venden dólares para los gastos en Bs
    tx(day(1), 'INCOME', 'Sueldo', acc.zinli, 'USD', 900, 'Sueldo', ['mensual'], 'sueldo');
    transfer(day(2), acc.zinli, acc.cash, 250, 245, 'Retiro en efectivo');
    const sell = Number(between(1.08, 1.16).toFixed(3)); // se vende algo por encima de la BCV
    transfer(day(2), acc.zinli, acc.bank, 280, Number(new D(280).mul(rateOf(day(2), 'BCV')).mul(sell).toFixed(2)), 'Venta de dólares');
    if (m % 2 === 1 || isLast2) tx(day(14 + m), 'INCOME', 'Trabajos extra', acc.cash, 'USD', Math.round(between(90, 260)), pick(['Landing para cliente', 'Mantenimiento web', 'Asesoría API']));
    if (m === MONTHS - 2) tx(day(22), 'INCOME', 'Otros ingresos', acc.bank, 'VES', bs(35, day(22)), 'Venta de silla usada');

    // Servicios fijos en bolívares
    if (day(3) < rec.internet.nextDate) tx(day(3), 'EXPENSE', 'Internet', acc.bank, 'VES', bs(between(22, 25), day(3)), 'Inter fibra 200 Mb', ['mensual'], 'internet');
    tx(day(5), 'EXPENSE', 'Luz y agua', acc.bank, 'VES', bs(between(6, 9), day(5)), 'Corpoelec e Hidrocapital', ['mensual'], 'luz');
    tx(day(6), 'EXPENSE', 'Servicios', acc.card, 'VES', bs(between(9, 11), day(6)), 'Plan Movistar', ['mensual']);
    tx(day(8), 'EXPENSE', 'Entretenimiento', acc.zinli, 'USD', 10.99, 'Netflix', ['mensual'], 'netflix');

    // Supermercado semanal, mitad en dólares efectivo y mitad con la tarjeta en Bs
    const markets = ['Automercado Plaza', 'Central Madeirense', 'Mercado de Chacao', 'Gama Express', 'Excelsior Gama', 'Forum'];
    for (let w = 0; w < 5; w++) {
      const d = day(2 + w * 7);
      if (w % 2) tx(d, 'EXPENSE', 'Supermercado', acc.bank, 'VES', bs(between(38, 72), d), pick(markets), ['casa']);
      else tx(d, 'EXPENSE', 'Supermercado', acc.cash, 'USD', between(30, 65).toFixed(2), pick(markets), ['casa']);
    }

    // Comida fuera y transporte, más frecuentes en los dos últimos meses
    const outings = isLast2 ? 9 : 5;
    for (let i = 0; i < outings; i++) {
      const d = day(1 + Math.floor(between(0, 28)));
      tx(d, 'EXPENSE', 'Comida fuera', acc.cash, 'USD', between(6, 28).toFixed(2), pick(['Arepera La Esquina', 'Café con Ana', 'Pizza del viernes', 'Sushi', 'Cachapas El Tigre', 'Empanadas', 'Hamburguesas']), rnd() > 0.6 ? ['salida'] : []);
    }
    const rides = isLast2 ? 10 : 6;
    for (let i = 0; i < rides; i++) {
      const d = day(1 + Math.floor(between(0, 28)));
      if (rnd() > 0.35) tx(d, 'EXPENSE', 'Transporte', acc.cash, 'USD', between(2.5, 9).toFixed(2), pick(['Yummy Rides', 'Ridery', 'Taxi']));
      else tx(d, 'EXPENSE', 'Transporte', acc.bank, 'VES', bs(between(15, 30), d), 'Gasolina');
    }

    // Variables
    tx(day(11), 'EXPENSE', 'Farmacia', acc.card, 'VES', bs(between(8, 25), day(11)), pick(['Farmatodo', 'Locatel']));
    if (m % 3 === 2 || m === MONTHS - 1) tx(day(19), 'EXPENSE', 'Salud', acc.zinli, 'USD', between(35, 70).toFixed(2), 'Consulta médica');
    tx(day(24), 'EXPENSE', 'Hogar', acc.bank, 'VES', bs(between(12, 45), day(24)), pick(['Ferretería EPA', 'Productos de limpieza', 'Bombillos y enchufes']), ['casa']);
    tx(day(17), 'EXPENSE', 'Entretenimiento', acc.zinli, 'USD', between(12, 35).toFixed(2), pick(['Cine y cotufas', 'Concierto', 'Juego en Steam']), ['salida']);
    if (isLast2) tx(day(26), 'EXPENSE', 'Otros gastos', acc.cash, 'USD', between(8, 20).toFixed(2), 'Regalo de cumpleaños');
  }

  await prisma.transaction.createMany({ data: txs });
  await prisma.transfer.createMany({ data: transfers });

  // Presupuestos mensuales en USD
  for (const [name, amountUsd] of [['Supermercado', '280'], ['Comida fuera', '150'], ['Transporte', '160'], ['Entretenimiento', '60'], ['Servicios', '55']]) {
    await prisma.budget.create({ data: { userId, categoryId: cat[name].id, amountUsd } });
  }

  // Metas con aportes de los meses anteriores
  const fondo = await prisma.savingsGoal.create({ data: { userId, name: 'Fondo de emergencia', targetUsd: '1500', targetDate: monthDay(28, 8), monthlyUsd: '120', color: '#1f6f78', createdAt: desde } });
  const viaje = await prisma.savingsGoal.create({ data: { userId, name: 'Viaje a Mérida', targetUsd: '450', targetDate: monthDay(15, 2), color: '#a855f7', createdAt: desde } });
  for (let m = 0; m < MONTHS; m++) {
    const d = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth() + m, 3));
    if (d <= today) await prisma.goalContribution.create({ data: { goalId: fondo.id, date: d, amountUsd: m === 3 ? '-40' : '110', note: m === 3 ? 'Reparación del carro' : null } });
    if (m >= MONTHS - 3 && d <= today) await prisma.goalContribution.create({ data: { goalId: viaje.id, date: d, amountUsd: '60' } });
  }

  // Deudas: una mía en curso, una que me deben vencida y una ya saldada
  const person = async (name, phone) => prisma.person.create({ data: { userId, name, phone } });
  const P = { tia: await person('Tía Carmen'), luis: await person('Luis', '584141112233'), pedro: await person('Pedro'), ana: await person('Ana', '584121234567') };
  const tia = await prisma.debt.create({ data: { userId, personId: P.tia.id, direction: 'I_OWE', person: 'Tía Carmen', description: 'Préstamo para el seguro del carro', currency: 'USD', amount: '200', dueDate: monthDay(30, 2) } });
  await prisma.debtPayment.create({ data: { debtId: tia.id, date: monthDay(1, -1), amount: '50' } });
  await prisma.debtPayment.create({ data: { debtId: tia.id, date: monthDay(1) <= today ? monthDay(1) : monthDay(1, -1), amount: '30' } });
  await prisma.debt.create({ data: { userId, personId: P.luis.id, direction: 'OWED_TO_ME', person: 'Luis', description: 'Entradas del concierto', currency: 'VES', amount: '9800', dueDate: addDays(today, -6) } });
  const pedro = await prisma.debt.create({ data: { userId, personId: P.pedro.id, direction: 'I_OWE', person: 'Pedro', description: 'Almuerzo de la oficina', currency: 'USD', amount: '25', settledAt: addDays(today, -20) } });
  await prisma.debtPayment.create({ data: { debtId: pedro.id, date: addDays(today, -20), amount: '25' } });

  // Una cena compartida que pagué yo, a partes iguales con Ana y Luis (Ana ya pagó su parte)
  const cenaDate = addDays(today, -3);
  const cenaRate = rateOf(cenaDate, 'BCV');
  const cena = await prisma.sharedExpense.create({
    data: {
      userId, splitMode: 'EQUAL', totalUsd: '48',
      participants: { create: [{ personId: null, pct: '33.333333', amountUsd: '16' }, { personId: P.ana.id, pct: '33.333333', amountUsd: '16' }, { personId: P.luis.id, pct: '33.333334', amountUsd: '16' }] },
    },
  });
  await prisma.transaction.create({
    data: {
      userId, accountId: acc.zinli.id, categoryId: cat['Comida fuera'].id, type: 'EXPENSE', date: cenaDate, description: 'Cena en Las Mercedes', tags: [],
      originalCurrency: 'USD', originalAmount: '48', amountUsd: '48', amountVes: new D(48).mul(cenaRate).toDecimalPlaces(2), rateUsed: cenaRate, rateSource: 'BCV',
      myAmountUsd: '16', myAmountVes: new D(16).mul(cenaRate).toDecimalPlaces(2), sharePct: '33.333333', sharedId: cena.id,
    },
  });
  const dAna = await prisma.debt.create({ data: { userId, personId: P.ana.id, sharedId: cena.id, direction: 'OWED_TO_ME', person: 'Ana', description: 'Cena en Las Mercedes (compartido)', currency: 'USD', amount: '16' } });
  await prisma.debtPayment.create({ data: { debtId: dAna.id, date: addDays(today, -1), amount: '16', accountId: acc.zinli.id } });
  await prisma.debt.update({ where: { id: dAna.id }, data: { settledAt: addDays(today, -1) } });
  await prisma.debt.create({ data: { userId, personId: P.luis.id, sharedId: cena.id, direction: 'OWED_TO_ME', person: 'Luis', description: 'Cena en Las Mercedes (compartido)', currency: 'USD', amount: '16' } });

  // Una nevera con Cashea: 40 % de inicial y 3 cuotas cada 14 días; la primera ya pagada
  const compra = addDays(today, -20);
  const cRate = rateOf(compra, 'BCV');
  const plan = await prisma.installmentPlan.create({
    data: {
      userId, provider: 'Cashea', store: 'Daka', description: 'Nevera', categoryId: cat['Hogar'].id, purchaseDate: compra, totalUsd: '480', downPaymentUsd: '192',
      count: 3, frequency: 'DAYS_14', accountId: acc.zinli.id, rateSource: 'BCV', rateUsed: cRate,
      installments: { create: [6, -8, -22].map((back, i) => ({ n: i + 1, dueDate: addDays(today, -back), amountUsd: '96' })) },
    },
    include: { installments: true },
  });
  const cashTx = (date, amount, description, rate) =>
    prisma.transaction.create({
      data: {
        userId, accountId: acc.zinli.id, categoryId: cat['Hogar'].id, type: 'EXPENSE', date, description, tags: [], source: 'INSTALLMENT', installmentPlanId: plan.id,
        originalCurrency: 'USD', originalAmount: amount, amountUsd: amount, amountVes: new D(amount).mul(rate).toDecimalPlaces(2), rateUsed: rate, rateSource: 'BCV',
        myAmountUsd: amount, myAmountVes: new D(amount).mul(rate).toDecimalPlaces(2),
      },
    });
  await cashTx(compra, '192', 'Cashea: Nevera (inicial)', cRate);
  const c1 = plan.installments.find((i) => i.n === 1);
  const paid1 = await cashTx(c1.dueDate, '96', 'Cashea: Nevera (cuota 1/3)', rateOf(c1.dueDate, 'BCV'));
  await prisma.installment.update({ where: { id: c1.id }, data: { transactionId: paid1.id } });

  const mesActual = txs.filter((t) => t.date.getUTCMonth() === today.getUTCMonth()).length;
  console.log(`Listo: ${txs.length} movimientos y ${transfers.length} transferencias en ${MONTHS} meses (${mesActual} movimientos este mes), 4 cuentas y ${Object.keys(cat).length} categorías.`);
  console.log('También: 4 recurrentes (uno pendiente de confirmar), 5 presupuestos, 2 metas, 4 personas, una cena compartida, una compra en Cashea y 3 deudas.');
  console.log(`Tasas inventadas para días sin tasa real: ${tasasNuevas}.`);
  console.log(`Entra con ${EMAIL} / ${PASSWORD}`);
}

(process.argv.includes('--borrar') ? borrar() : crear())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
