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

(async () => {
  if (MODE === 'inspect') { await inspect(); return; }
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
