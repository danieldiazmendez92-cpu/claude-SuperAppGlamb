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

(async () => {
  const nowSnap = await REF.get();
  const now = nowSnap.exists ? nowSnap.data() : {};
  console.log('=== ESTADO ACTUAL ===');
  console.log(JSON.stringify(summarize(now), null, 1));

  // Snapshots horarios: desde hace 6 días hasta hace 2 horas.
  const hours = [];
  const end = new Date(); end.setMinutes(0, 0, 0); end.setHours(end.getHours() - 2);
  for (let h = 0; h < 142; h++) hours.push(new Date(end.getTime() - h * 3600e3));

  let best = null; // snapshot más RECIENTE que contenga registros que hoy faltan
  const nowExpIds = new Set((now.expenses || []).map(e => e.id));
  const nowDedIds = new Set((now.payrollDeductions || []).map(d => d.id));
  const seen = [];
  for (const when of hours) {
    const d = await readAt(when);
    if (!d) continue;
    if (d.__error) { seen.push(`${when.toISOString()} ERROR ${d.__error}`); continue; }
    const missExp = (d.expenses || []).filter(e => e && e.id && !nowExpIds.has(e.id));
    const missDed = (d.payrollDeductions || []).filter(x => x && x.id && !nowDedIds.has(x.id));
    if ((missExp.length || missDed.length) && !best) {
      best = { when, missExp, missDed, counts: summarize(d) };
    }
    seen.push(`${when.toISOString()} exp=${(d.expenses||[]).length} ded=${(d.payrollDeductions||[]).length} faltantesHoy=${missExp.length + missDed.length}`);
    if (best && when < new Date(best.when.getTime() - 48 * 3600e3)) break; // ya cubrimos 48h antes del mejor
  }
  console.log('=== ESCANEO (hora UTC) ===');
  seen.slice(0, 60).forEach(s => console.log(s));

  if (!best) {
    console.log('RESULTADO: ningún snapshot histórico tiene registros que falten hoy. Nada para restaurar.');
    return;
  }
  console.log('=== MEJOR SNAPSHOT (más reciente con datos hoy ausentes):', best.when.toISOString(), '===');
  console.log(JSON.stringify(best.counts, null, 1));
  console.log('GASTOS FALTANTES HOY:', JSON.stringify(best.missExp, null, 1));
  console.log('DESCUENTOS FALTANTES HOY:', JSON.stringify(best.missDed, null, 1));

  if (MODE !== 'restore') { console.log('MODE=diagnose → no se escribió nada.'); return; }

  await db.runTransaction(async (t) => {
    const snap = await t.get(REF);
    const cur = snap.exists ? snap.data() : {};
    const curExp = cur.expenses || [], curDed = cur.payrollDeductions || [];
    const curExpIds = new Set(curExp.map(e => e.id)), curDedIds = new Set(curDed.map(d => d.id));
    const addExp = best.missExp.filter(e => !curExpIds.has(e.id));
    const addDed = best.missDed.filter(d => !curDedIds.has(d.id));
    t.update(REF, {
      expenses: [...curExp, ...addExp],
      payrollDeductions: [...curDed, ...addDed],
    });
    console.log(`RESTAURADO: +${addExp.length} gasto(s), +${addDed.length} descuento(s). Nada eliminado ni reemplazado.`);
  });
  const after = (await REF.get()).data();
  console.log('=== ESTADO DESPUÉS ==='); console.log(JSON.stringify(summarize(after), null, 1));
})().catch(e => { console.error('FALLO:', e); process.exit(1); });
