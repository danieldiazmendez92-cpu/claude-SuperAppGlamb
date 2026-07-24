// Recuperación de datos de financePrivate/main vía PITR (point-in-time recovery).
// Corre en GitHub Actions con la cuenta de servicio del deploy.
//
// Modos (env MODE):
//   diagnose — solo lectura: escanea snapshots horarios de los últimos días,
//              muestra qué registros existían antes y ya no están.
//   restore  — agrega al documento actual los gastos (expenses) y descuentos
//              (payrollDeductions) que faltan, por unión de ids. NUNCA borra
//              ni reemplaza nada; NO toca liquidations (hubo un borrador
//              eliminado a propósito) ni ninguna otra clave.
const { Firestore, Timestamp } = require('@google-cloud/firestore');

const MODE = process.env.MODE || 'diagnose';
const creds = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
const db = new Firestore({ projectId: 'glamb-os', credentials: creds });
const REF = db.collection('financePrivate').doc('main');

// inspect: foto del estado actual — doc financePrivate/main + colecciones
// nuevas por-registro + hitos de migración. Solo lectura.
// restore-collections: PITR-escanea el doc histórico y escribe lo faltante
// DIRECTO en las colecciones nuevas (la fuente de verdad desde el blindaje).
async function inspect() {
  const nowSnap = await REF.get();
  const now = nowSnap.exists ? nowSnap.data() : {};
  console.log('=== DOC financePrivate/main ===');
  console.log(JSON.stringify({
    expenses: (now.expenses||[]).length, payrollDeductions: (now.payrollDeductions||[]).length,
    liquidations: (now.liquidations||[]).length, keys: Object.keys(now).sort(),
    rents: (now.expenses||[]).filter(e=>/local|alquil/i.test(e.description||'')).map(e=>({id:e.id,d:e.date,a:e.amount,t:e.description})),
    anticipos: (now.payrollDeductions||[]).map(x=>({id:x.id,d:x.date,a:x.amount,t:x.type,desc:x.description}))
  }, null, 1));
  for (const coll of ['financeExpenses','financeDeductions','financeLiquidations']) {
    const s = await db.collection(coll).get();
    const rents = coll==='financeExpenses' ? s.docs.map(d=>d.data()).filter(e=>/local|alquil/i.test(e.description||'')).map(e=>({id:e.id,d:e.date,a:e.amount,t:e.description})) : [];
    console.log(`=== COLECCIÓN ${coll}: ${s.size} docs ===`, rents.length?JSON.stringify(rents):'');
    if(coll!=='financeExpenses') s.docs.slice(0,10).forEach(d=>{const x=d.data();console.log('  ·',x.id,x.date||'',x.type||x.status||'',x.amount||x.netPay||'',(x.description||x.collaboratorName||'').slice(0,40));});
  }
  const mig = await db.collection('appState').doc('migrations').get();
  console.log('=== MIGRACIONES ===', JSON.stringify(mig.exists?mig.data():{}));
}

const summarize = (d) => ({
  expenses: (d.expenses || []).length,
  payrollDeductions: (d.payrollDeductions || []).length,
  liquidations: (d.liquidations || []).length,
  alquiler: (d.expenses || []).filter(e => /alquil/i.test(`${e.description || ''} ${e.category || ''}`)).map(e => ({ id: e.id, date: e.date, amount: e.amount, description: e.description })),
  anticipos: (d.payrollDeductions || []).filter(x => /anticipo|adelanto/i.test(`${x.type || ''} ${x.description || ''}`)).map(x => ({ id: x.id, date: x.date, amount: x.amount, collaboratorId: x.collaboratorId, description: x.description, appliedTo: x.appliedToLiquidationId || null })),
});

async function readAt(date) {
  try {
    return await db.runTransaction(async (t) => {
      const snap = await t.get(REF);
      return snap.exists ? snap.data() : null;
    }, { readOnly: true, readTime: Timestamp.fromDate(date) });
  } catch (e) {
    return { __error: String(e.message || e).slice(0, 120) };
  }
}

// Lee una COLECCIÓN entera a un timestamp histórico (PITR).
async function readCollAt(coll, date) {
  try {
    return await db.runTransaction(async (t) => {
      const snap = await t.get(db.collection(coll));
      return snap.docs.map(d => d.data());
    }, { readOnly: true, readTime: Timestamp.fromDate(date) });
  } catch (e) { return null; }
}
const CFG = db.collection('appState').doc('config');
const cierreLine = c => `id=${c.id} apertura=${c.openingAmount ?? '?'} abierta=${(c.openedAt||'').slice(0,16)} cerrada=${(c.closedAt||'').slice(0,16)} retiros=${(c.withdrawals||[]).length} gastos=${(c.expenses||[]).length}`;

async function inspectCaja() {
  const cur = await db.collection('cashClosings').get();
  console.log(`=== CIERRES DE CAJA HOY EN LA BASE: ${cur.size} ===`);
  cur.docs.map(d => d.data()).sort((a,b)=>String(b.closedAt||'').localeCompare(String(a.closedAt||''))).forEach(c => console.log('  ·', cierreLine(c)));
  const cfg = (await CFG.get()).data() || {};
  const cs = cfg.cashSession || {};
  console.log('=== SESIÓN ACTUAL (appState/config) ===', JSON.stringify({isOpen:cs.isOpen, openedAt:cs.openedAt, openingAmount:cs.openingAmount, retiros:(cs.withdrawals||[]).length, gastos:(cs.expenses||[]).length}));

  // PITR: detectar cierres que existieron y hoy no están, y sesiones con retiros.
  const nowIds = new Set(cur.docs.map(d => (d.data().id || d.id)));
  const hours = [];
  const end = new Date(); end.setMinutes(0,0,0); end.setHours(end.getHours()-1);
  for (let h = 0; h < 142; h++) hours.push(new Date(end.getTime() - h*3600e3));
  const missing = new Map(); const sessionsSeen = [];
  for (const when of hours) {
    const docs = await readCollAt('cashClosings', when);
    if (docs) docs.forEach(c => { if (c && c.id && !nowIds.has(c.id) && !missing.has(c.id)) missing.set(c.id, c); });
    const h = await readAt(when); // reutilizado para el doc financePrivate — acá necesitamos config:
    try {
      const cfgh = await db.runTransaction(async (t) => { const s = await t.get(CFG); return s.exists ? s.data() : null; }, { readOnly: true, readTime: Timestamp.fromDate(when) });
      const c = cfgh && cfgh.cashSession;
      if (c && (c.withdrawals||[]).length) sessionsSeen.push(`${when.toISOString()} sesión abierta=${(c.openedAt||'').slice(0,16)} apertura=${c.openingAmount} retiros=${(c.withdrawals||[]).length}: ${(c.withdrawals||[]).map(w=>`${w.reason||''} $${w.amount}`).join(' | ')}`);
    } catch(e) {}
  }
  console.log(`=== CIERRES QUE EXISTIERON Y HOY FALTAN: ${missing.size} ===`);
  [...missing.values()].forEach(c => console.log('  FALTA:', cierreLine(c), 'retirosDetalle:', JSON.stringify((c.withdrawals||[]).map(w=>({r:w.reason,a:w.amount,t:(w.createdAt||'').slice(0,16)})))));
  console.log('=== SESIONES CON RETIROS VISTAS EN EL HISTORIAL (por hora) ===');
  sessionsSeen.slice(0,80).forEach(s => console.log(' ', s));
}

async function restoreCaja() {
  const cur = await db.collection('cashClosings').get();
  const nowIds = new Set(cur.docs.map(d => (d.data().id || d.id)));
  const hours = [];
  const end = new Date(); end.setMinutes(0,0,0); end.setHours(end.getHours()-1);
  for (let h = 0; h < 142; h++) hours.push(new Date(end.getTime() - h*3600e3));
  const missing = new Map();
  for (const when of hours) {
    const docs = await readCollAt('cashClosings', when);
    if (docs) docs.forEach(c => { if (c && c.id && !nowIds.has(c.id) && !missing.has(c.id)) missing.set(c.id, c); });
  }
  console.log('CIERRES a restaurar:', JSON.stringify([...missing.values()].map(cierreLine), null, 1));
  const docId = v => String(v).replace(/[\/.]/g, '_');
  let batch = db.batch(); let n = 0;
  for (const c of missing.values()) { batch.set(db.collection('cashClosings').doc(docId(c.id)), c); n++; }
  if (n) await batch.commit();
  console.log(`RESTAURADO: ${n} cierre(s) de caja. Nada eliminado ni reemplazado.`);
}

// inspect-commissions: SOLO LECTURA. Diagnóstico del cálculo de comisiones.
// Vuelca (a) la estructura del catálogo (grupo→servicio→variante con ids),
// (b) la config de comisiones de cada colaboradora (pct por grupo + overrides
// por servicio, resolviendo el serviceId a su nombre real), y (c) las líneas
// de venta cuyo servicio menciona "extensi", mostrando a qué servicio resuelve
// su variantId — para ver si el override matchea o no. No imprime datos de
// clientes (solo grupo/servicio/variantId/colaboradora/monto).
async function inspectCommissions() {
  const catSnap = await db.collection('appState').doc('catalog').get();
  const catalog = (catSnap.exists ? (catSnap.data().catalog || catSnap.data()) : {}) || {};
  const groups = catalog.groups || [];
  const variantToService = {};   // variantId -> {serviceId, serviceName, groupId, groupName}
  const serviceById = {};        // serviceId -> {name, groupName}
  console.log('=== CATÁLOGO: grupos / servicios / variantes ===');
  groups.forEach(g => {
    console.log(`GRUPO id=${g.id} "${g.name}"`);
    (g.services || []).forEach(s => {
      serviceById[s.id] = { name: s.name, groupName: g.name };
      console.log(`   SERVICIO id=${s.id} "${s.name}"`);
      (s.variants || []).forEach(v => {
        variantToService[v.id] = { serviceId: s.id, serviceName: s.name, groupId: g.id, groupName: g.name };
        console.log(`      VARIANTE id=${v.id} "${v.name}" $${v.price}`);
      });
    });
  });

  console.log('\n=== COMISIONES CONFIGURADAS POR COLABORADORA ===');
  const collabs = await db.collection('collaborators').get();
  collabs.docs.forEach(d => {
    const c = d.data();
    const name = ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || c.name || d.id;
    const comm = (c.payroll && c.payroll.commissions) || [];
    if (!comm.length) return;
    console.log(`COLAB id=${d.id} "${name}"`);
    comm.forEach(gc => {
      const ovs = (gc.serviceOverrides || []).map(o => {
        const svc = serviceById[o.serviceId];
        return `{serviceId=${o.serviceId} → ${svc ? '"' + svc.name + '" (grupo ' + svc.groupName + ')' : 'NO EXISTE EN CATÁLOGO'} pct=${o.pct}}`;
      });
      console.log(`   grupo groupId=${gc.groupId} groupName="${gc.groupName}" pct=${gc.pct} overrides=[${ovs.join(', ')}]`);
    });
  });

  console.log('\n=== LÍNEAS DE VENTA "extensi*" — resolución de variantId ===');
  const tickets = await db.collection('salesTickets').get();
  let count = 0;
  tickets.docs.forEach(d => {
    const t = d.data();
    if (t.status === 'voided') return;
    (t.lines || []).forEach(l => {
      const svcTxt = `${l.service || ''} ${l.group || ''}`;
      if (!/extensi/i.test(svcTxt)) return;
      count++;
      const res = variantToService[l.variantId];
      console.log(`ticket=${d.id.slice(0,8)} fecha=${(t.createdAt || '').slice(0,10)} colab=${l.collaboratorId} group="${l.group}" service="${l.service}" variantId=${l.variantId} → resuelve a: ${res ? 'servicio id=' + res.serviceId + ' "' + res.serviceName + '"' : 'NO RESUELVE (variante inexistente en catálogo actual)'} finalPrice=${l.finalPrice} disc=${l.discountType || 'none'}`);
    });
  });
  if (!count) console.log('(sin líneas de venta que mencionen "extensi")');
}

// simulate-commissions: SOLO LECTURA. Replica EXACTAMENTE la lógica desplegada
// de getCollaboratorCommission (con fallback por nombre) y calcula, línea por
// línea, qué % le corresponde a cada colaboradora en julio. Sirve para
// confirmar del lado del servidor si el fix produce el % correcto, sin navegador
// ni caché de por medio.
async function simulateCommissions() {
  const catSnap = await db.collection('appState').doc('catalog').get();
  const catalog = (catSnap.exists ? (catSnap.data().catalog || catSnap.data()) : {}) || {};
  const groups = catalog.groups || [];
  const getVariantFromId = (variantId) => {
    for (const g of groups) for (const s of (g.services||[])) {
      const v = (s.variants||[]).find(x => x.id === variantId);
      if (v) return { group: g, service: s, variant: v };
    }
    return null;
  };
  // Réplica literal de la función desplegada en el HTML.
  const getCollaboratorCommission = (m, groupName, variantId, serviceName) => {
    if (!m.payroll || !m.payroll.commissions) return { pct: 0, why: 'sin payroll' };
    const gc = m.payroll.commissions.find(c => c.groupName === groupName || c.groupId === groupName);
    if (!gc) return { pct: 0, why: 'grupo no configurado' };
    if (gc.serviceOverrides && gc.serviceOverrides.length) {
      let serviceId = null, how = '';
      const vi = variantId ? getVariantFromId(variantId) : null;
      if (vi) { serviceId = vi.service.id; how = 'por variantId'; }
      else if (serviceName) {
        const g = groups.find(x => x.name === groupName || x.id === groupName);
        if (g) {
          const s = (g.services||[]).find(s => s.name === serviceName || (s.variants||[]).some(v => v.name === serviceName));
          if (s) { serviceId = s.id; how = 'por NOMBRE (variante huérfana)'; }
        }
      }
      const ov = gc.serviceOverrides.find(o => (serviceId && o.serviceId === serviceId) || (variantId && o.serviceId === variantId));
      if (ov) return { pct: ov.pct || 0, why: `override ${how} → serviceId=${serviceId}` };
      return { pct: gc.pct || 0, why: `sin override (serviceId=${serviceId||'no resuelto'}, ${how||'no resuelto'}) → grupo` };
    }
    return { pct: gc.pct || 0, why: 'grupo (sin overrides)' };
  };

  const collabs = await db.collection('collaborators').get();
  const byId = {};
  collabs.docs.forEach(d => { byId[d.id] = d.data(); });
  const tickets = await db.collection('salesTickets').get();
  console.log('=== SIMULACIÓN DE COMISIONES (julio, lógica desplegada) ===');
  const rows = [];
  tickets.docs.forEach(d => {
    const t = d.data();
    if (t.status === 'voided') return;
    if (!(t.createdAt >= '2026-07-01' && t.createdAt <= '2026-07-31T23:59:59')) return;
    (t.lines || []).forEach(l => {
      const m = byId[l.collaboratorId];
      if (!m) return;
      const name = ((m.firstName||'')+' '+(m.lastName||'')).trim() || m.name || l.collaboratorId;
      const r = getCollaboratorCommission(m, l.group, l.variantId, l.service);
      rows.push({ name, group: l.group, service: l.service, variantId: l.variantId, pct: r.pct, why: r.why });
    });
  });
  // foco en Andrea + cualquier línea de extensiones
  rows.filter(r => /andrea/i.test(r.name) || /extensi/i.test(`${r.service} ${r.group}`)).forEach(r => {
    console.log(`${r.name} | ${r.group} | "${r.service}" | ${r.pct}% | ${r.why}`);
  });
}

// inspect-liq-finance: SOLO LECTURA. Para (a) diagnosticar el login lento
// —tamaño y claves del doc financePrivate/main, que se lee al arrancar— y
// (b) obtener las liquidaciones pagadas y si ya generaron gasto (expenseId),
// para saber cuál sueldo falta cargar en Finanzas.
async function inspectLiqFinance() {
  const fp = await REF.get();
  const d = fp.exists ? fp.data() : {};
  const bytes = Buffer.byteLength(JSON.stringify(d), 'utf8');
  console.log('=== financePrivate/main ===');
  console.log('tamaño total:', (bytes/1024).toFixed(1), 'KB');
  Object.keys(d).sort().forEach(k => {
    const v = d[k];
    const sz = Buffer.byteLength(JSON.stringify(v), 'utf8');
    const n = Array.isArray(v) ? v.length + ' items' : (v && typeof v === 'object' ? Object.keys(v).length + ' keys' : typeof v);
    console.log(`  ${k}: ${(sz/1024).toFixed(1)} KB (${n})`);
  });

  console.log('\n=== financeLiquidations (todas) ===');
  const liqs = await db.collection('financeLiquidations').get();
  console.log('total docs:', liqs.size);
  liqs.docs.map(x=>x.data()).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))).forEach(l => {
    console.log(`  id=${l.id} · ${l.collaboratorName||'—'} · período=${l.period?.label||''} (${l.period?.from||''}→${l.period?.to||''}) · estado=${l.status} · neto=${l.netPay} · pagadaEl=${(l.paidAt||'').slice(0,10)||'—'} · expenseId=${l.expenseId||'NINGUNO'}`);
  });

  console.log('\n=== financeExpenses categoría salaries (sueldos ya registrados) ===');
  const exps = await db.collection('financeExpenses').get();
  exps.docs.map(x=>x.data()).filter(e=>e.category==='salaries').forEach(e=>{
    console.log(`  ${e.date} · ${e.description} · ${e.amount} · ${e.paymentMethod||''} · id=${e.id}`);
  });
}

// inspect-reportes: SOLO LECTURA. Corre la lógica desplegada de los reportes
// "Servicios" y "Recaudación" sobre los datos REALES y muestra totales + chequeos
// de coherencia (campos poblados, señas pendientes ≤ cobradas, etc.).
async function inspectReportes() {
  const PERIOD_FROM = process.env.REP_FROM || '2026-07-01';
  const PERIOD_TO   = process.env.REP_TO   || '2026-07-31';
  const ticketsSnap = await db.collection('salesTickets').get();
  const paysSnap = await db.collection('payments').get();
  const tickets = ticketsSnap.docs.map(d => d.data());
  const payments = paysSnap.docs.map(d => d.data());
  const finTicketDay = t => t.date || (t.createdAt ? t.createdAt.slice(0,10) : '');
  const reservationCharged = key => !!key && tickets.some(tk => tk.reservationId===key && (tk.status==='confirmed'||tk.status==='partial'));
  const _lineDiscount = l => { if(!l||!l.discountType||l.discountType==='none') return 0; const base=Number(l.basePrice!=null?l.basePrice:l.finalPrice||0); return Math.max(0,base-Number(l.finalPrice||0)); };

  // Servicios
  const inR = t => finTicketDay(t)>=PERIOD_FROM && finTicketDay(t)<=PERIOD_TO;
  const svcT = tickets.filter(t => t.status!=='voided' && inR(t));
  let facturado=0, conDesc=0, sinServicesTotal=0; const svcMetodo={};
  svcT.forEach(t=>{ const lines=t.lines||[]; const total=t.servicesTotal!=null?Number(t.servicesTotal):lines.reduce((s,l)=>s+Number(l.finalPrice||0),0); if(t.servicesTotal==null) sinServicesTotal++; facturado+=total; if(lines.some(l=>l.discountType&&l.discountType!=='none')) conDesc++; payments.filter(p=>p.ticketId===t.id&&!p.voided&&(p.type==='service'||p.type==='deposit_applied')).forEach(p=>{const m=p.method||'—'; svcMetodo[m]=(svcMetodo[m]||0)+Number(p.amount||0);}); });

  // Recaudación
  const inRP = p => { const d=(p.createdAt||'').slice(0,10); return d>=PERIOD_FROM && d<=PERIOD_TO; };
  const rpays = payments.filter(p=>!p.voided && (p.type==='service'||p.type==='deposit_received') && inRP(p));
  let recTotal=0; const recMetodo={};
  rpays.forEach(p=>{ recTotal+=Number(p.amount||0); const m=p.method||'—'; recMetodo[m]=(recMetodo[m]||0)+Number(p.amount||0); });
  const recibidas = payments.filter(p=>!p.voided && p.type==='deposit_received' && inRP(p));
  const senasCobradas = recibidas.reduce((s,p)=>s+Number(p.amount||0),0);
  const senasPend = recibidas.filter(p=>!(p.bookingId&&reservationCharged(p.bookingId))).reduce((s,p)=>s+Number(p.amount||0),0);
  const recibidasSinBooking = recibidas.filter(p=>!p.bookingId).length;

  console.log(`=== PERÍODO ${PERIOD_FROM} → ${PERIOD_TO} ===`);
  console.log('\n--- REPORTE 1: Servicios ---');
  console.log('ventas (tickets no anulados):', svcT.length);
  console.log('total facturado (sin propina):', facturado);
  console.log('ventas con descuento:', conDesc);
  console.log('total por medio de pago:', JSON.stringify(svcMetodo));
  console.log('CHEQUEO tickets sin servicesTotal (usan fallback finalPrice):', sinServicesTotal, '/', svcT.length);
  console.log('\n--- REPORTE 2: Recaudación ---');
  console.log('ingresos (service+seña recibida):', rpays.length);
  console.log('total recaudado:', recTotal);
  console.log('recaudación por método:', JSON.stringify(recMetodo));
  console.log('señas cobradas:', senasCobradas);
  console.log('señas pendientes de aplicación:', senasPend);
  console.log('CHEQUEO señas pendientes ≤ cobradas:', senasPend<=senasCobradas ? 'OK' : '⚠️ FALLA');
  console.log('CHEQUEO señas recibidas sin bookingId (se cuentan siempre pendientes):', recibidasSinBooking, '/', recibidas.length);
  const tipsInRange = payments.filter(p=>!p.voided && p.type==='tip_in' && inRP(p));
  console.log('CHEQUEO propinas excluidas del período:', tipsInRange.length, '(no deben sumar a recaudación)');
  const appliedInRange = payments.filter(p=>!p.voided && p.type==='deposit_applied' && inRP(p));
  console.log('CHEQUEO señas aplicadas excluidas de recaudación:', appliedInRange.length, 'movimientos por', appliedInRange.reduce((s,p)=>s+Number(p.amount||0),0));
}

(async () => {
  if (MODE === 'inspect') { await inspect(); return; }
  if (MODE === 'inspect-commissions') { await inspectCommissions(); return; }
  if (MODE === 'simulate-commissions') { await simulateCommissions(); return; }
  if (MODE === 'inspect-reportes') { await inspectReportes(); return; }
  if (MODE === 'inspect-liq-finance') { await inspectLiqFinance(); return; }
  if (MODE === 'inspect-caja') { await inspectCaja(); return; }
  if (MODE === 'restore-caja') { await restoreCaja(); return; }

  if (MODE === 'restore-collections') {
    // La verdad ahora son las colecciones por-registro: comparar lo que existió
    // en el doc histórico (PITR) contra las COLECCIONES y escribir lo faltante
    // como documentos individuales. Aditivo, nunca borra.
    const expSnap = await db.collection('financeExpenses').get();
    const dedSnap = await db.collection('financeDeductions').get();
    const haveExp = new Set(expSnap.docs.map(d => (d.data().id || d.id)));
    const haveDed = new Set(dedSnap.docs.map(d => (d.data().id || d.id)));
    console.log(`Colecciones hoy: financeExpenses=${expSnap.size} financeDeductions=${dedSnap.size}`);
    const hours2 = [];
    const end2 = new Date(); end2.setMinutes(0, 0, 0); end2.setHours(end2.getHours() - 1);
    for (let h = 0; h < 142; h++) hours2.push(new Date(end2.getTime() - h * 3600e3));
    const addExp = new Map(), addDed = new Map();
    for (const when of hours2) {
      const d = await readAt(when);
      if (!d || d.__error) continue;
      (d.expenses || []).forEach(e => { if (e && e.id && !haveExp.has(e.id) && !addExp.has(e.id)) addExp.set(e.id, e); });
      (d.payrollDeductions || []).forEach(x => { if (x && x.id && !haveDed.has(x.id) && !addDed.has(x.id)) addDed.set(x.id, x); });
    }
    // También lo que esté en el doc ACTUAL y falte en las colecciones (por si
    // la restauración anterior al doc quedó huérfana de la migración).
    const curDoc = (await REF.get()).data() || {};
    (curDoc.expenses || []).forEach(e => { if (e && e.id && !haveExp.has(e.id) && !addExp.has(e.id)) addExp.set(e.id, e); });
    (curDoc.payrollDeductions || []).forEach(x => { if (x && x.id && !haveDed.has(x.id) && !addDed.has(x.id)) addDed.set(x.id, x); });
    console.log('GASTOS a escribir en financeExpenses:', JSON.stringify([...addExp.values()], null, 1));
    console.log('DESCUENTOS a escribir en financeDeductions:', JSON.stringify([...addDed.values()], null, 1));
    const docId = v => String(v).replace(/[\/.]/g, '_');
    let batch = db.batch(); let n = 0;
    for (const e of addExp.values()) { batch.set(db.collection('financeExpenses').doc(docId(e.id)), e); n++; }
    for (const x of addDed.values()) { batch.set(db.collection('financeDeductions').doc(docId(x.id)), x); n++; }
    if (n) await batch.commit();
    console.log(`RESTAURADO EN COLECCIONES: ${addExp.size} gasto(s), ${addDed.size} descuento(s).`);
    return;
  }

  const nowSnap = await REF.get();
  const now = nowSnap.exists ? nowSnap.data() : {};
  console.log('=== ESTADO ACTUAL ===');
  console.log(JSON.stringify(summarize(now), null, 1));

  // Snapshots horarios: desde hace 6 días hasta hace 2 horas.
  const hours = [];
  const end = new Date(); end.setMinutes(0, 0, 0); end.setHours(end.getHours() - 2);
  for (let h = 0; h < 142; h++) hours.push(new Date(end.getTime() - h * 3600e3));

  // Acumular TODO lo que existió en algún snapshot y hoy falta (unión por id,
  // conservando la versión más nueva de cada registro: se escanea de nuevo→viejo).
  const nowExpIds = new Set((now.expenses || []).map(e => e.id));
  const nowDedIds = new Set((now.payrollDeductions || []).map(d => d.id));
  const missExpMap = new Map(), missDedMap = new Map();
  const seen = [];
  for (const when of hours) {
    const d = await readAt(when);
    if (!d) continue;
    if (d.__error) { seen.push(`${when.toISOString()} ERROR ${d.__error}`); continue; }
    (d.expenses || []).forEach(e => { if (e && e.id && !nowExpIds.has(e.id) && !missExpMap.has(e.id)) missExpMap.set(e.id, e); });
    (d.payrollDeductions || []).forEach(x => { if (x && x.id && !nowDedIds.has(x.id) && !missDedMap.has(x.id)) missDedMap.set(x.id, x); });
    seen.push(`${when.toISOString()} exp=${(d.expenses||[]).length} ded=${(d.payrollDeductions||[]).length}`);
  }
  console.log('=== ESCANEO COMPLETO (hora UTC) ===');
  seen.forEach(s => console.log(s));

  const addExpAll = [...missExpMap.values()], addDedAll = [...missDedMap.values()];
  if (!addExpAll.length && !addDedAll.length) {
    console.log('RESULTADO: ningún snapshot histórico tiene registros que falten hoy. Nada para restaurar.');
    return;
  }
  console.log('GASTOS FALTANTES HOY (unión de todos los snapshots):', JSON.stringify(addExpAll, null, 1));
  console.log('DESCUENTOS FALTANTES HOY (unión de todos los snapshots):', JSON.stringify(addDedAll, null, 1));

  if (MODE !== 'restore') { console.log('MODE=diagnose → no se escribió nada.'); return; }

  await db.runTransaction(async (t) => {
    const snap = await t.get(REF);
    const cur = snap.exists ? snap.data() : {};
    const curExp = cur.expenses || [], curDed = cur.payrollDeductions || [];
    const curExpIds = new Set(curExp.map(e => e.id)), curDedIds = new Set(curDed.map(d => d.id));
    const addExp = addExpAll.filter(e => !curExpIds.has(e.id));
    const addDed = addDedAll.filter(d => !curDedIds.has(d.id));
    t.update(REF, {
      expenses: [...curExp, ...addExp],
      payrollDeductions: [...curDed, ...addDed],
    });
    console.log(`RESTAURADO: +${addExp.length} gasto(s), +${addDed.length} descuento(s). Nada eliminado ni reemplazado.`);
  });
  const after = (await REF.get()).data();
  console.log('=== ESTADO DESPUÉS ==='); console.log(JSON.stringify(summarize(after), null, 1));
})().catch(e => { console.error('FALLO:', e); process.exit(1); });
