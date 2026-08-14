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
// Firestore exige que el readTime de una transacción de solo lectura histórica
// caiga en un minuto exacto (sin segundos ni milisegundos) — si no, tira
// FAILED_PRECONDITION: "read_time is not a whole minute". Toda lectura PITR de
// este archivo tiene que pasar su fecha por acá antes de usarla como readTime.
const alMinuto = d => new Date(Math.floor(d.getTime() / 60000) * 60000);

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

// inspect-retention: SOLO LECTURA. Diagnostica los emails de reactivación:
// cuántas clientas califican hoy, cómo está el registro anti-duplicados
// (comms.sentLog, tope 100) y cuántos mails repetidos salieron de verdad.
async function inspectRetention() {
  const [cfgSnap, mainSnap] = await Promise.all([
    db.doc('appState/config').get(), db.doc('appState/main').get(),
  ]);
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const main = mainSnap.exists ? mainSnap.data() : {};
  const comms = cfg.comms || main.comms || {};
  const ret = (comms.templates || {}).retention || {};
  console.log('=== PLANTILLA retention ===');
  console.log('enabled:', ret.enabled, '| daysAfter:', ret.daysAfter, '| subject:', JSON.stringify(ret.subject || ''));
  console.log('comms vive en:', cfgSnap.exists && cfg.comms ? 'appState/config' : 'appState/main');
  console.log('body guardado:', JSON.stringify(ret.body || ''));
  console.log('bizName:', JSON.stringify(comms.bizName || ''), '| claves de comms:', Object.keys(comms).join(','));

  const log = comms.sentLog || [];
  const byType = {};
  log.forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });
  const dates = log.map(e => e.sentAt).filter(Boolean).sort();
  console.log('\n=== comms.sentLog (registro anti-duplicados) ===');
  console.log('entradas:', log.length, '(tope duro: 100)');
  console.log('por tipo:', JSON.stringify(byType));
  console.log('más vieja:', dates[0] || '—', '| más nueva:', dates[dates.length - 1] || '—');
  if (dates.length > 1) {
    const spanH = (Date.parse(dates[dates.length-1]) - Date.parse(dates[0])) / 3600000;
    console.log('el registro solo recuerda las últimas', spanH.toFixed(1), 'horas');
  }
  const retKeys = log.filter(e => e.type === 'retention').map(e => e.apptId);
  console.log('claves retention guardadas:', retKeys.length, JSON.stringify(retKeys.slice(0, 20)));

  // Candidatas de hoy, replicando getRetentionCandidates() de la app
  const [clientsSnap, apptsSnap] = await Promise.all([
    db.collection('clients').get(), db.collection('appointments').get(),
  ]);
  const clients = clientsSnap.docs.map(d => d.data());
  const appts = apptsSnap.docs.map(d => d.data());
  const privSnap = await db.collection('clientsPrivate').get();
  const priv = {}; privSnap.docs.forEach(d => priv[d.id] = d.data());
  const today = new Date().toISOString().slice(0, 10);
  const daysAfter = Number(ret.daysAfter || 27);
  const cutoff = new Date(Date.now() - daysAfter * 86400000).toISOString().slice(0, 10);
  const byClient = {};
  appts.forEach(a => {
    if (a.isAdditional) return;
    if (['cancelled','cancelado','voided'].includes(a.status)) return;
    (byClient[a.clientId] = byClient[a.clientId] || []).push(a);
  });
  const cands = clients.filter(c => {
    const email = c.email || (priv[c.id] && priv[c.id].email);
    if (!email && !c.phone) return false;
    const cas = byClient[c.id] || [];
    if (!cas.length) return false;
    const last = cas.filter(a => (a.date||'') <= today).sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
    if (!last || (last.date||'') > cutoff) return false;
    return !cas.some(a => (a.date||'') > today);
  });
  const withEmail = cands.filter(c => c.email || (priv[c.id] && priv[c.id].email));
  console.log('\n=== CANDIDATAS A REACTIVACIÓN (hoy) ===');
  console.log('total que califican:', cands.length, '| con email (o sea, que reciben mail):', withEmail.length);
  console.log('capacidad del registro para retention: 100 menos lo que ocupen los otros tipos');
  if (withEmail.length > retKeys.length) {
    console.log('>>> ALERTA: hay', withEmail.length, 'candidatas y solo', retKeys.length, 'recordadas: el resto se vuelve a enviar.');
  }

  // Mails realmente encolados: repetidos por destinatario
  const mailSnap = await db.collection('mail').get();
  const subj = String(ret.subject || '').replace(/\{\{\w+\}\}/g, '').trim().slice(0, 18);
  const rows = mailSnap.docs.map(d => d.data()).filter(m => {
    const s = (m.message && m.message.subject) || '';
    return subj && s.includes(subj);
  });
  console.log('\n=== MAILS DE REACTIVACIÓN REALMENTE ENCOLADOS ===');
  console.log('coincidencias por asunto', JSON.stringify(subj), ':', rows.length, 'de', mailSnap.size, 'mails totales');
  const per = {};
  rows.forEach(m => {
    const to = (Array.isArray(m.to) ? m.to[0] : m.to) || '?';
    const when = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().toISOString().slice(0,16) : '';
    (per[to] = per[to] || []).push(when);
  });
  const last = rows.sort((a,b)=>String((a.createdAt&&a.createdAt.toMillis&&a.createdAt.toMillis())||0)-String((b.createdAt&&b.createdAt.toMillis&&b.createdAt.toMillis())||0)).slice(-1)[0];
  if (last) console.log('TEXTO REALMENTE ENVIADO (último):', JSON.stringify(((last.message||{}).text||'').slice(0,400)));
  const dup = Object.entries(per).filter(([,v]) => v.length > 1).sort((a,b)=>b[1].length-a[1].length);
  console.log('destinatarios distintos:', Object.keys(per).length, '| con MÁS DE UN envío:', dup.length);
  dup.slice(0, 15).forEach(([to, when]) => {
    const anon = to.replace(/^(.).*(@.*)$/, '$1***$2');
    console.log('  ·', anon, '→', when.length, 'envíos:', when.sort().join(', '));
  });
}

// seed-retention-guards: ESCRIBE, pero solo crea candados que IMPIDEN enviar
// mails. Marca como "ya avisada" a toda clienta que YA recibió un mail de
// reactivación, para que la nueva función programada no le mande uno más.
// No borra ni modifica nada más. Idempotente.
async function seedRetentionGuards() {
  const APPLY = process.env.SEED_APPLY === '1' || MODE.endsWith('-apply');
  const cfg = (await db.doc('appState/config').get()).data() || {};
  const comms = cfg.comms || {};
  const ret = (comms.templates || {}).retention || {};
  const subj = String(ret.subject || '').replace(/\{\{\w+\}\}/g, '').trim().slice(0, 18);
  if (!subj) { console.log('Sin asunto de referencia; abortado.'); return; }

  const mailSnap = await db.collection('mail').get();
  const lastByEmail = {};
  mailSnap.docs.forEach((d) => {
    const m = d.data();
    const s = (m.message && m.message.subject) || '';
    if (!s.includes(subj)) return;
    const to = (Array.isArray(m.to) ? m.to[0] : m.to) || '';
    const ms = m.createdAt && m.createdAt.toMillis ? m.createdAt.toMillis() : 0;
    if (!to) return;
    if (!lastByEmail[to] || ms > lastByEmail[to]) lastByEmail[to] = ms;
  });
  console.log('emails que ya recibieron reactivación:', Object.keys(lastByEmail).length);

  // email -> clientId
  const [clientsSnap, privSnap, apptsSnap] = await Promise.all([
    db.collection('clients').get(),
    db.collection('clientsPrivate').get(),
    db.collection('appointments').select('clientId', 'date', 'status', 'isAdditional').get(),
  ]);
  const idByEmail = {};
  clientsSnap.docs.forEach((d) => { const c = d.data() || {}; if (c.email) idByEmail[c.email.toLowerCase()] = d.id; });
  privSnap.docs.forEach((d) => { const c = d.data() || {}; if (c.email) idByEmail[c.email.toLowerCase()] = d.id; });

  const today = new Date().toISOString().slice(0, 10);
  const lastAppt = {};
  apptsSnap.docs.forEach((d) => {
    const a = d.data() || {};
    if (a.isAdditional) return;
    if (a.status && ['cancelled', 'cancelado', 'voided'].includes(a.status)) return;
    if (!a.clientId || !a.date || a.date > today) return;
    if (!lastAppt[a.clientId] || a.date > lastAppt[a.clientId]) lastAppt[a.clientId] = a.date;
  });

  let n = 0; let miss = 0;
  for (const [email, ms] of Object.entries(lastByEmail)) {
    const id = idByEmail[email.toLowerCase()];
    if (!id) { miss++; console.log('  sin clienta para', email.replace(/^(.).*(@.*)$/, '$1***$2')); continue; }
    const doc = {
      type: 'retention', clientId: id,
      lastApptDate: lastAppt[id] || '',
      lastSentAtMs: ms || Date.now(),
      seededFromMailHistory: true,
    };
    console.log('  candado →', id, 'últimoTurno=', doc.lastApptDate, 'últimoMail=', new Date(doc.lastSentAtMs).toISOString().slice(0, 10));
    if (APPLY) await db.doc(`sentReminders/retention_${id}`).set(doc, {merge: true});
    n++;
  }
  console.log(APPLY ? `ESCRITO: ${n} candado(s).` : `SIMULACIÓN: se crearían ${n} candado(s). Usá el modo seed-retention-guards-apply para aplicar.`);
  if (miss) console.log('sin correspondencia:', miss);
}

// fix-liq-expenses: crea el gasto de sueldo que falta para las liquidaciones
// PAGADAS que quedaron sin él (las que se pagaron antes de que existiera el
// registro automático). Replica exactamente lo que hace la app al marcar
// pagada: gasto en categoría "salaries" con fecha de pago, y enlace
// liq.expenseId para que no se duplique nunca más.
// Idempotente: si la liquidación ya tiene expenseId, no hace nada.
async function fixLiqExpenses() {
  const APPLY = MODE.endsWith('-apply');
  const METHOD = process.env.PAY_METHOD || 'Transferencia';
  const docId = (v) => String(v).replace(/[\/.]/g, '_');

  const [liqs, exps] = await Promise.all([
    db.collection('financeLiquidations').get(),
    db.collection('financeExpenses').get(),
  ]);
  const all = exps.docs.map((d) => d.data());
  const pend = liqs.docs.filter((d) => {
    const l = d.data();
    return l.status === 'paid' && !l.expenseId && Number(l.netPay) > 0;
  });
  console.log('liquidaciones pagadas sin gasto:', pend.length);

  for (const d of pend) {
    const l = d.data();
    const date = String(l.paidAt || '').slice(0, 10);
    const description = `Sueldo ${l.collaboratorName} · ${(l.period && l.period.label) || ''}`;
    // Chequeo anti-duplicado por si ya se cargó a mano mientras tanto.
    const dup = all.find((e) => e.date === date && Number(e.amount) === Number(l.netPay) && e.category === 'salaries');
    if (dup) { console.log('  YA EXISTE un gasto igual, no se crea:', JSON.stringify({d: dup.date, a: dup.amount, t: dup.description})); continue; }

    const id = 'exp' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
    const exp = {id, date, category: 'salaries', description, amount: Number(l.netPay), paymentMethod: METHOD};
    console.log('  GASTO A CREAR:', JSON.stringify(exp), '→ liquidación', l.id);
    if (APPLY) {
      await db.collection('financeExpenses').doc(docId(id)).set(exp);
      await db.collection('financeLiquidations').doc(d.id).set({expenseId: id}, {merge: true});
      console.log('    escrito y enlazado.');
    }
  }
  console.log(APPLY ? 'LISTO.' : 'SIMULACIÓN: nada escrito. Usá fix-liq-expenses-apply.');
}

// audit-caja: SOLO LECTURA. Reproduce EXACTAMENTE cashExpectedAmount() de la
// app sobre la sesión de caja abierta, y muestra de dónde sale cada peso:
//   apertura + cobros en efectivo desde openedAt − retiros − gastos en efectivo
// Además lista los pagos que quedaron AFUERA del cálculo y por qué (método con
// otra grafía, sin fecha, anulado, anterior a la apertura), que es donde se
// esconden las diferencias.
async function auditCaja() {
  const cfg = (await CFG.get()).data() || {};
  const s = cfg.cashSession || {};
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
  // Fecha y hora en horario argentino (UTC-3), que es como las ve el salón.
  const ar = (t) => { const d = new Date(String(t || '')); return isNaN(d) ? '??' : new Date(d.getTime() - 3 * 3600000).toISOString().replace('T', ' ').slice(5, 16); };
  const hora = ar;

  console.log('=== SESIÓN DE CAJA ===');
  console.log('abierta:', s.isOpen, '| abrió:', s.openedBy || '?', '| openedAt:', s.openedAt || '—');
  console.log('monto de apertura:', money(s.openingAmount));
  if (s.openingCorrectedFrom != null) console.log('  (apertura corregida: de', money(s.openingCorrectedFrom), 'a', money(s.openingAmount), 'el', s.openingCorrectedAt, ')');

  const since = s.openedAt || '';
  const pays = (await db.collection('payments').get()).docs.map((d) => d.data());
  const tickets = {};
  (await db.collection('salesTickets').get()).docs.forEach((d) => { const t = d.data(); tickets[t.id || d.id] = t; });
  const clients = {};
  (await db.collection('clients').get()).docs.forEach((d) => { const c = d.data(); clients[c.id || d.id] = `${c.first || ''} ${c.last || ''}`.trim(); });

  const nombre = (p) => {
    if (p.clientId && clients[p.clientId]) return clients[p.clientId];
    const t = p.ticketId && tickets[p.ticketId];
    if (t && t.clientId && clients[t.clientId]) return clients[t.clientId];
    return '—';
  };

  // Lo que la app SÍ cuenta
  const inSession = pays.filter((p) => p.method === 'Efectivo' && !p.voided && (p.createdAt || '') >= since);
  const cashIn = inSession.reduce((a, p) => a + Number(p.amount || 0), 0);
  console.log(`\n=== COBROS EN EFECTIVO QUE SUMA EL SISTEMA (${inSession.length}) ===`);
  inSession.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach((p) => {
    console.log(`  ${hora(p.createdAt)} · ${money(p.amount)} · ${nombre(p)} · ${p.type || ''}${p.ticketId ? ' · ticket ' + p.ticketId : ''}`);
  });
  console.log('  SUBTOTAL cobrado en efectivo:', money(cashIn));
  // ¿La sesión abarca más de un día? Es la causa más común de que el número
  // "esperado" no coincida con lo que el salón contó de una sola jornada.
  const porDia = {};
  inSession.forEach((p) => { const d = ar(p.createdAt).slice(0, 5); porDia[d] = (porDia[d] || 0) + Number(p.amount || 0); });
  const dias = Object.keys(porDia).sort();
  console.log('  cobros en efectivo POR DÍA:', JSON.stringify(porDia));
  if (dias.length > 1) console.log(`  >>> ATENCIÓN: la caja lleva ${dias.length} días abierta (${dias.join(', ')}). El "esperado" acumula todos esos días, no solo hoy.`);
  console.log('  apertura de la sesión (hora AR):', ar(s.openedAt));

  // Retiros y gastos
  const ws = s.withdrawals || [];
  const wTot = ws.reduce((a, w) => a + Number(w.amount || 0), 0);
  console.log(`\n=== RETIROS (${ws.length}) ===`);
  ws.forEach((w) => console.log(`  ${hora(w.createdAt)} · ${money(w.amount)} · ${w.reason || ''}${w.voided ? '  [ANULADO — ojo: el cálculo lo resta igual]' : ''}`));
  console.log('  SUBTOTAL retiros:', money(wTot));

  const exAll = s.expenses || [];
  const exCash = exAll.filter((e) => e.method === 'Efectivo');
  const eTot = exCash.reduce((a, e) => a + Number(e.amount || 0), 0);
  console.log(`\n=== GASTOS DE CAJA (${exAll.length}, en efectivo ${exCash.length}) ===`);
  exAll.forEach((e) => console.log(`  ${hora(e.createdAt)} · ${money(e.amount)} · ${e.category || ''} · ${e.method || '?'}${e.method !== 'Efectivo' ? '  (no resta: no es efectivo)' : ''}${e.voided ? '  [ANULADO — se resta igual]' : ''}`));
  console.log('  SUBTOTAL gastos en efectivo:', money(eTot));

  const esperado = Number(s.openingAmount || 0) + cashIn - wTot - eTot;
  console.log('\n=== CUENTA FINAL (igual que la app) ===');
  console.log(`  ${money(s.openingAmount)} (apertura)`);
  console.log(`+ ${money(cashIn)} (cobros en efectivo)`);
  console.log(`− ${money(wTot)} (retiros)`);
  console.log(`− ${money(eTot)} (gastos en efectivo)`);
  console.log(`= ${money(esperado)}  ← EFECTIVO ESPERADO`);

  // Dónde se esconden las diferencias
  console.log('\n=== PAGOS QUE NO ENTRARON EN LA CUENTA (y por qué) ===');
  const hoy = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const fuera = pays.filter((p) => !inSession.includes(p) && String(p.createdAt || '').slice(0, 10) === hoy);
  if (!fuera.length) console.log('  ninguno de hoy');
  fuera.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach((p) => {
    const razones = [];
    if (p.method !== 'Efectivo') razones.push(`método="${p.method}"`);
    if (p.voided) razones.push('ANULADO');
    if (!p.createdAt) razones.push('sin fecha/hora');
    else if (p.createdAt < since) razones.push('anterior a la apertura de caja');
    console.log(`  ${hora(p.createdAt)} · ${money(p.amount)} · ${nombre(p)} → ${razones.join(' + ') || '?'}`);
  });

  // Grafías de método usadas hoy: si hay "efectivo" o "EFECTIVO", no suman.
  const grafias = {};
  pays.filter((p) => String(p.createdAt || '').slice(0, 10) === hoy).forEach((p) => {
    grafias[String(p.method)] = (grafias[String(p.method)] || 0) + 1;
  });
  console.log('\n=== GRAFÍAS DE MEDIO DE PAGO USADAS HOY ===');
  console.log(' ', JSON.stringify(grafias));
  const sospechosas = Object.keys(grafias).filter((m) => m !== 'Efectivo' && /efectiv/i.test(m));
  if (sospechosas.length) console.log('  >>> ALERTA: estas se escriben distinto y NO suman al efectivo:', JSON.stringify(sospechosas));
}


// audit-retiros: SOLO LECTURA. Rastrea la sesión de caja hora por hora hacia
// atrás (PITR) y muestra CADA VEZ que cambia la lista de retiros o gastos.
// Sirve para saber si un retiro que "falta" existió alguna vez y en qué
// momento desapareció — anular un retiro lo BORRA del registro, no lo marca.
async function auditRetiros() {
  const HORAS = Number(process.env.PITR_HORAS || 72);
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
  const ar = (t) => { const d = new Date(String(t || '')); return isNaN(d) ? '??' : new Date(d.getTime() - 3 * 3600000).toISOString().replace('T', ' ').slice(5, 16); };
  const firma = (c) => JSON.stringify({
    ap: c ? c.openingAmount : null,
    w: ((c && c.withdrawals) || []).map((x) => `${ar(x.createdAt)}|${x.amount}|${x.reason || ''}`).sort(),
    e: ((c && c.expenses) || []).map((x) => `${ar(x.createdAt)}|${x.amount}|${x.category || ''}`).sort(),
  });

  // Cierres guardados: si un día se cerró bien, sus retiros quedaron ahí.
  console.log('=== CIERRES DE CAJA GUARDADOS ===');
  const cls = await db.collection('cashClosings').get();
  cls.docs.map((d) => d.data()).sort((a, b) => String(a.closedAt).localeCompare(String(b.closedAt))).forEach((c) => {
    const ws = c.withdrawals || [];
    console.log(`  cerrado ${ar(c.closedAt)} · abierto ${ar(c.openedAt)} · apertura ${money(c.openingAmount)} · esperado ${money(c.expectedCash)} · contado ${money(c.countedCash)} · dif ${money(c.difference)}`);
    console.log(`     retiros (${ws.length}):`, ws.length ? ws.map((x) => `${ar(x.createdAt)} ${money(x.amount)} ${x.reason || ''}`).join(' | ') : '—');
  });
  if (!cls.size) console.log('  NINGUNO: nunca se cerró la caja.');

  const snaps = [];
  const end = new Date(); end.setMinutes(0, 0, 0);
  for (let h = 0; h <= HORAS; h++) snaps.push(new Date(end.getTime() - h * 3600e3));
  snaps.reverse(); // del más viejo al más nuevo

  let prev = null;
  console.log(`=== HISTORIAL DE LA CAJA (últimas ${HORAS} h, hora AR) ===`);
  for (const when of snaps) {
    let cfg = null;
    try {
      cfg = await db.runTransaction(async (t) => {
        const sn = await t.get(CFG); return sn.exists ? sn.data() : null;
      }, { readOnly: true, readTime: Timestamp.fromDate(when) });
    } catch (e) { continue; }  // fuera de la ventana PITR
    const c = cfg && cfg.cashSession;
    const f = firma(c);
    if (f === prev) continue;
    prev = f;
    console.log(`\n--- ${ar(when.toISOString())} ---`);
    if (!c) { console.log('   (sin sesión de caja)'); continue; }
    console.log(`   abierta=${c.isOpen} · desde ${ar(c.openedAt)} · apertura=${money(c.openingAmount)}`);
    const ws = c.withdrawals || [];
    console.log(`   RETIROS (${ws.length}):`, ws.length ? ws.map((x) => `${ar(x.createdAt)} ${money(x.amount)} ${x.reason || ''}`).join(' | ') : '—');
    const es = c.expenses || [];
    console.log(`   GASTOS (${es.length}):`, es.length ? es.map((x) => `${ar(x.createdAt)} ${money(x.amount)} ${x.category || ''} ${x.method || ''}`).join(' | ') : '—');
  }

  // Resumen: todos los retiros que aparecieron alguna vez vs los que quedan hoy
  console.log('\n=== ¿ALGÚN RETIRO EXISTIÓ Y HOY NO ESTÁ? ===');
  const vistos = new Map();
  for (const when of snaps) {
    let cfg = null;
    try {
      cfg = await db.runTransaction(async (t) => { const sn = await t.get(CFG); return sn.exists ? sn.data() : null; }, { readOnly: true, readTime: Timestamp.fromDate(when) });
    } catch (e) { continue; }
    ((cfg && cfg.cashSession && cfg.cashSession.withdrawals) || []).forEach((w) => {
      if (!vistos.has(w.id)) vistos.set(w.id, { w, visto: ar(when.toISOString()) });
      vistos.get(w.id).ultimo = ar(when.toISOString());
    });
  }
  const hoy = (await CFG.get()).data() || {};
  const actuales = new Set((((hoy.cashSession || {}).withdrawals) || []).map((w) => w.id));
  let faltan = 0;
  vistos.forEach((v, id) => {
    if (actuales.has(id)) return;
    faltan++;
    console.log(`   DESAPARECIÓ: ${money(v.w.amount)} · ${v.w.reason || ''} · creado ${ar(v.w.createdAt)} · visible desde ${v.visto} hasta ${v.ultimo} · id=${id}`);
  });
  if (!faltan) console.log('   ninguno: todos los retiros que existieron siguen estando.');
}


// fix-caja-openedat: corrige la fecha de apertura de la sesión de caja actual
// cuando quedó APUNTANDO A UN DÍA ANTERIOR (una copia vieja de otro equipo la
// pisó). No toca montos, retiros ni gastos: solo openedAt, que es lo que hace
// que el cálculo sume cobros de jornadas ya cerradas y contadas.
// La fecha correcta NO se inventa: se lee del historial (PITR).
async function fixCajaOpenedAt() {
  const APPLY = MODE.endsWith('-apply');
  const REF_UTC = process.env.PITR_REF || '2026-07-31T13:00:00Z';
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
  const ar = (t) => { const d = new Date(String(t || '')); return isNaN(d) ? '??' : new Date(d.getTime() - 3 * 3600000).toISOString().replace('T', ' ').slice(5, 16); };

  const cfg = (await CFG.get()).data() || {};
  const cur = cfg.cashSession;
  if (!cur) { console.log('No hay sesión de caja. Nada que hacer.'); return; }
  console.log('=== SESIÓN ACTUAL ===');
  console.log('  openedAt:', cur.openedAt, `(${ar(cur.openedAt)})`, '| apertura:', money(cur.openingAmount), '| abierta:', cur.isOpen);

  // Fecha correcta según el historial
  let hist = null;
  try {
    hist = await db.runTransaction(async (t) => {
      const sn = await t.get(CFG); return sn.exists ? sn.data() : null;
    }, { readOnly: true, readTime: Timestamp.fromDate(new Date(REF_UTC)) });
  } catch (e) { console.log('No se pudo leer el historial:', e.message); return; }
  const buena = hist && hist.cashSession;
  if (!buena || !buena.openedAt) { console.log('El historial no tiene sesión en', REF_UTC); return; }
  console.log('=== SESIÓN SEGÚN EL HISTORIAL (' + REF_UTC + ') ===');
  console.log('  openedAt:', buena.openedAt, `(${ar(buena.openedAt)})`, '| apertura:', money(buena.openingAmount));

  if (!(Date.parse(buena.openedAt) > Date.parse(cur.openedAt))) {
    console.log('\nLa fecha actual NO es anterior a la del historial: no hay nada que corregir.');
    return;
  }

  // Efecto sobre el efectivo esperado, antes y después
  const pays = (await db.collection('payments').get()).docs.map((d) => d.data());
  const suma = (desde) => pays.filter((p) => p.method === 'Efectivo' && !p.voided && (p.createdAt || '') >= desde)
      .reduce((a, p) => a + Number(p.amount || 0), 0);
  const w = (cur.withdrawals || []).reduce((a, x) => a + Number(x.amount || 0), 0);
  const g = (cur.expenses || []).filter((x) => x.method === 'Efectivo').reduce((a, x) => a + Number(x.amount || 0), 0);
  const esp = (desde) => Number(cur.openingAmount || 0) + suma(desde) - w - g;
  console.log('\n=== EFECTO EN EL EFECTIVO ESPERADO ===');
  console.log('  ANTES (desde ' + ar(cur.openedAt) + '):  cobros', money(suma(cur.openedAt)), '→ esperado', money(esp(cur.openedAt)));
  console.log('  DESPUÉS (desde ' + ar(buena.openedAt) + '): cobros', money(suma(buena.openedAt)), '→ esperado', money(esp(buena.openedAt)));
  console.log('  diferencia:', money(esp(cur.openedAt) - esp(buena.openedAt)), '(cobros de jornadas ya cerradas que se estaban contando de nuevo)');

  if (!APPLY) { console.log('\nSIMULACIÓN: no se escribió nada. Usá fix-caja-openedat-apply.'); return; }

  const nueva = Object.assign({}, cur, {
    openedAt: buena.openedAt,
    openedAtFixedFrom: cur.openedAt,          // rastro para auditoría
    openedAtFixedAt: new Date().toISOString(),
  });
  await CFG.set({ cashSession: nueva }, { merge: true });
  const verif = (await CFG.get()).data().cashSession;
  console.log('\nCORREGIDO. openedAt ahora:', verif.openedAt, `(${ar(verif.openedAt)})`);
  console.log('  se conservaron: apertura', money(verif.openingAmount), '· retiros', (verif.withdrawals || []).length, '· gastos', (verif.expenses || []).length);
  console.log('  efectivo esperado ahora:', money(esp(verif.openedAt)));
}


// fix-retiro-huerfano: un retiro hecho la MAÑANA de hoy, pero registrado en el
// cierre de la jornada anterior (la caja cruzó la medianoche y se cerró recién
// a la mañana), no lo resta el efectivo esperado: para la sesión actual ocurrió
// "antes de abrir". Pero la plata salió hoy, así que corresponde a hoy.
// Se COPIA a la sesión actual conservando el mismo id: el Ledger deduplica por
// id, así que sigue mostrándose una sola vez, y el cierre del día anterior
// queda intacto (cerró con diferencia cero y no hay que tocarlo).
async function fixRetiroHuerfano() {
  const APPLY = MODE.endsWith('-apply');
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
  const ar = (t) => { const d = new Date(String(t || '')); return isNaN(d) ? '??' : new Date(d.getTime() - 3 * 3600000).toISOString().replace('T', ' ').slice(5, 16); };

  const cfg = (await CFG.get()).data() || {};
  const ses = cfg.cashSession;
  if (!ses || !ses.openedAt) { console.log('No hay sesión de caja abierta.'); return; }
  const diaSesion = ses.openedAt.slice(0, 10);
  const yaTiene = new Set((ses.withdrawals || []).map((w) => w.id));
  console.log('=== SESIÓN ACTUAL ===');
  console.log('  abierta', ar(ses.openedAt), '· apertura', money(ses.openingAmount), '· retiros propios:', (ses.withdrawals || []).length);

  // Retiros en cierres anteriores con fecha del MISMO día que abrió la sesión
  const cls = await db.collection('cashClosings').get();
  const huerfanos = [];
  cls.docs.map((d) => d.data()).forEach((c) => {
    (c.withdrawals || []).forEach((w) => {
      if (!w || !w.id) return;
      if (yaTiene.has(w.id)) return;
      if (String(w.createdAt || '').slice(0, 10) !== diaSesion) return;
      if (huerfanos.some((x) => x.id === w.id)) return;
      huerfanos.push(w);
    });
  });
  console.log(`\n=== RETIROS DE HOY QUE QUEDARON EN UN CIERRE ANTERIOR (${huerfanos.length}) ===`);
  huerfanos.forEach((w) => console.log(`  ${ar(w.createdAt)} · ${money(w.amount)} · ${w.reason || ''} · id=${w.id}`));
  if (!huerfanos.length) { console.log('  ninguno: nada que corregir.'); return; }

  // Efecto en el efectivo esperado
  const pays = (await db.collection('payments').get()).docs.map((d) => d.data());
  const cashIn = pays.filter((p) => p.method === 'Efectivo' && !p.voided && (p.createdAt || '') >= ses.openedAt)
      .reduce((a, p) => a + Number(p.amount || 0), 0);
  const g = (ses.expenses || []).filter((x) => x.method === 'Efectivo').reduce((a, x) => a + Number(x.amount || 0), 0);
  const wAntes = (ses.withdrawals || []).reduce((a, x) => a + Number(x.amount || 0), 0);
  const wDespues = wAntes + huerfanos.reduce((a, x) => a + Number(x.amount || 0), 0);
  const base = Number(ses.openingAmount || 0) + cashIn - g;
  console.log('\n=== EFECTO EN EL EFECTIVO ESPERADO ===');
  console.log('  ANTES:  ', money(ses.openingAmount), '+', money(cashIn), '−', money(wAntes), '−', money(g), '=', money(base - wAntes));
  console.log('  DESPUÉS:', money(ses.openingAmount), '+', money(cashIn), '−', money(wDespues), '−', money(g), '=', money(base - wDespues));

  if (!APPLY) { console.log('\nSIMULACIÓN: no se escribió nada. Usá fix-retiro-huerfano-apply.'); return; }

  const nueva = Object.assign({}, ses, {
    withdrawals: [...(ses.withdrawals || []), ...huerfanos.map((w) => Object.assign({}, w, { movidoDesdeCierre: true }))],
  });
  await CFG.set({ cashSession: nueva }, { merge: true });
  const v = (await CFG.get()).data().cashSession;
  console.log('\nCORREGIDO. Retiros de la sesión:', (v.withdrawals || []).length);
  (v.withdrawals || []).forEach((w) => console.log(`  ${ar(w.createdAt)} · ${money(w.amount)} · ${w.reason || ''}`));
  const wFinal = (v.withdrawals || []).reduce((a, x) => a + Number(x.amount || 0), 0);
  console.log('  efectivo esperado ahora:', money(base - wFinal));
}


// audit-fechas: SOLO LECTURA. createdAt se guarda en UTC y la app agrupa por
// día cortando sus primeros 10 caracteres. Argentina es UTC-3, así que TODO lo
// que pasa después de las 21:00 queda contado en el día siguiente — justo la
// franja en la que más trabaja el salón. Acá se mide cuánto está corrido.
async function auditFechas() {
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
  const diaAR = (iso) => { const d = new Date(String(iso || '')); return isNaN(d) ? '' : new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10); };
  const diaUTC = (iso) => String(iso || '').slice(0, 10);

  for (const [coll, campo] of [['payments', 'createdAt'], ['salesTickets', 'createdAt']]) {
    const snap = await db.collection(coll).get();
    const docs = snap.docs.map((d) => d.data());
    const malos = docs.filter((x) => x[campo] && diaAR(x[campo]) !== diaUTC(x[campo]));
    console.log(`\n=== ${coll}: ${malos.length} de ${docs.length} están en el día equivocado ===`);
    const porDia = {};
    malos.forEach((x) => {
      const k = `${diaAR(x[campo])} → ${diaUTC(x[campo])}`;
      porDia[k] = porDia[k] || { n: 0, monto: 0 };
      porDia[k].n++;
      porDia[k].monto += Number(x.amount || x.grossTotal || 0);
    });
    Object.keys(porDia).sort().slice(-15).forEach((k) => {
      console.log(`   ${k} · ${porDia[k].n} movimiento(s) · ${money(porDia[k].monto)}`);
    });
    if (malos.length) {
      const hora = {};
      malos.forEach((x) => { const h = String(x[campo]).slice(11, 13); hora[h] = (hora[h] || 0) + 1; });
      console.log('   franja horaria UTC afectada:', JSON.stringify(hora));
    }
  }
}


// inspect-turno: SOLO LECTURA. Para un turno que aparece "ya cobrado" sin
// haberse cobrado. Muestra el turno, su clave de reserva (bookingId) y TODO lo
// que cuelga de esa clave: tickets, pagos y otros turnos que la compartan.
// La app considera cobrada una reserva si existe un ticket con
// reservationId == bookingId y estado confirmado o parcial.
async function inspectTurno() {
  const q = (process.env.TURNO_CLIENTE || '').toLowerCase();
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
  const [cls, aps, tks, pys] = await Promise.all([
    db.collection('clients').get(), db.collection('appointments').get(),
    db.collection('salesTickets').get(), db.collection('payments').get(),
  ]);
  const clients = {}; cls.docs.forEach((d) => { const c = d.data(); clients[c.id || d.id] = `${c.first || ''} ${c.last || ''}`.trim(); });
  const ids = Object.keys(clients).filter((id) => clients[id].toLowerCase().includes(q));
  console.log('clientas que coinciden con', JSON.stringify(q), ':', ids.map((i) => clients[i]).join(' | ') || 'ninguna');
  if (!ids.length) return;

  const appts = aps.docs.map((d) => d.data()).filter((a) => ids.includes(a.clientId));
  const tickets = tks.docs.map((d) => d.data());
  const pays = pys.docs.map((d) => d.data());

  appts.sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((a) => {
    const key = a.bookingId || a.id;
    console.log(`\n=== TURNO ${a.date} ${a.start}-${a.end} · ${a.service} · estado=${a.status || '—'} ===`);
    console.log('   id:', a.id, '| bookingId:', a.bookingId || '(ninguno)', '→ clave de reserva:', key);
    console.log('   deposit:', a.deposit || '—', '| depositAmount:', a.depositAmount != null ? money(a.depositAmount) : '—', '| depositMethod:', a.depositMethod || '—');
    const otros = aps.docs.map((d) => d.data()).filter((x) => (x.bookingId || x.id) === key && x.id !== a.id);
    if (otros.length) {
      console.log('   >>> OTROS TURNOS CON LA MISMA CLAVE:', otros.length);
      otros.forEach((x) => console.log(`       ${x.date} ${x.start} · ${x.service} · ${clients[x.clientId] || '?'} · estado=${x.status || '—'} · id=${x.id}`));
    }
    const tk = tickets.filter((t) => t.reservationId === key);
    console.log('   tickets con esa clave:', tk.length);
    tk.forEach((t) => {
      console.log(`       ticket ${t.id} · ${(t.createdAt || '').slice(0, 16)} · estado=${t.status} · bruto=${money(t.grossTotal)} · saldo pendiente=${money(t.pendingBalance)} · seña aplicada=${money(t.depositApplied)}`);
      console.log('         clienta del ticket:', t.clientNameSnapshot || clients[t.clientId] || '?');
      (t.lines || []).forEach((l) => console.log(`         línea: ${l.service || l.group || '?'} · ${money(l.finalPrice)} · colaboradora=${l.collaboratorId || '—'}`));
      const pt = pays.filter((x) => x.ticketId === t.id);
      console.log('         pagos de ese ticket:', pt.length);
      pt.forEach((x) => console.log(`           ${(x.createdAt || '').slice(0, 16)} · ${x.type} · ${money(x.amount)} · ${x.method}${x.voided ? ' · ANULADO' : ''}`));
    });
    const cuenta = tk.some((t) => t.status === 'confirmed' || t.status === 'partial');
    console.log('   ¿la app lo da por COBRADO?', cuenta ? 'SÍ' : 'no');
    const pg = pays.filter((x) => x.bookingId === key || (a.id && x.appointmentId === a.id));
    console.log('   pagos ligados a la reserva:', pg.length);
    pg.forEach((x) => console.log(`       ${(x.createdAt || '').slice(0, 16)} · ${x.type} · ${money(x.amount)} · ${x.method}${x.voided ? ' · ANULADO' : ''} · ticket=${x.ticketId || '—'}`));
  });
}


// anular-ticket: anula un ticket exactamente como lo hace la app (voidTicket):
// estado 'voided' + motivo + se anulan sus pagos. Se usa para tickets viejos que
// desde la app son difíciles de alcanzar. Muestra el antes y el después.
async function anularTicket() {
  const APPLY = MODE.endsWith('-apply');
  const ID = process.env.TICKET_ID || '';
  const MOTIVO = process.env.TICKET_MOTIVO || 'Anulado por corrección';
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
  if (!ID) { console.log('Falta TICKET_ID.'); return; }

  const tks = await db.collection('salesTickets').get();
  const doc = tks.docs.find((d) => (d.data().id || d.id) === ID);
  if (!doc) { console.log('No existe el ticket', ID); return; }
  const t = doc.data();
  console.log('=== TICKET ===');
  console.log(' ', t.id, '·', (t.createdAt || '').slice(0, 16), '· estado=', t.status, '· bruto=', money(t.grossTotal), '· reserva=', t.reservationId || '—', '· origen=', t.origin || '—');
  (t.lines || []).forEach((l) => console.log('   línea:', l.service || l.group, money(l.finalPrice)));
  if (t.status === 'voided') { console.log('Ya estaba anulado. Nada que hacer.'); return; }

  const pys = await db.collection('payments').get();
  const pagos = pys.docs.filter((d) => d.data().ticketId === ID);
  console.log('pagos del ticket:', pagos.length);
  pagos.forEach((d) => { const x = d.data(); console.log('  ', (x.createdAt || '').slice(0, 16), x.type, money(x.amount), x.method, x.voided ? '· ya anulado' : ''); });

  if (!APPLY) { console.log('\nSIMULACIÓN: no se escribió nada. Usá anular-ticket-apply.'); return; }

  const now = new Date().toISOString();
  await doc.ref.set({ status: 'voided', voidReason: MOTIVO, voidedBy: 'Corrección asistida', voidedAt: now }, { merge: true });
  for (const d of pagos) await d.ref.set({ voided: true, voidReason: MOTIVO, voidedAt: now }, { merge: true });
  const after = (await doc.ref.get()).data();
  console.log('\nANULADO. estado=', after.status, '· motivo:', after.voidReason);
  console.log('pagos anulados:', pagos.length);
}


// inspect-senas: SOLO LECTURA. Trazabilidad de las señas de una clienta:
// cuánto entró, a qué reserva estaba asignada cada una, y a qué ticket se
// terminó aplicando. Sirve para detectar una seña de un turno futuro que se
// consumió en el cobro de otro turno.
async function inspectSenas() {
  const q = (process.env.TURNO_CLIENTE || '').toLowerCase();
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
  const ar = (t) => { const d = new Date(String(t || '')); return isNaN(d) ? '??' : new Date(d.getTime() - 3 * 3600000).toISOString().replace('T', ' ').slice(0, 16); };
  const [cls, aps, tks, pys] = await Promise.all([
    db.collection('clients').get(), db.collection('appointments').get(),
    db.collection('salesTickets').get(), db.collection('payments').get(),
  ]);
  const clients = {}; cls.docs.forEach((d) => { const c = d.data(); clients[c.id || d.id] = `${c.first || ''} ${c.last || ''}`.trim(); });
  const ids = Object.keys(clients).filter((id) => clients[id].toLowerCase().includes(q));
  console.log('clienta(s):', ids.map((i) => clients[i]).join(' | ') || 'ninguna');
  if (!ids.length) return;
  const appts = aps.docs.map((d) => d.data()).filter((a) => ids.includes(a.clientId));
  const tickets = tks.docs.map((d) => d.data());
  const pays = pys.docs.map((d) => d.data()).filter((p) => ids.includes(p.clientId));

  console.log('\n=== TURNOS ===');
  appts.sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((a) => {
    const key = a.bookingId || a.id;
    const tk = tickets.filter((t) => t.reservationId === key && t.status !== 'voided');
    console.log(`  ${a.date} ${a.start} · ${a.service} · estado=${a.status || '—'} · seña en turno=${a.depositAmount != null ? money(a.depositAmount) : '—'} · reserva=${key}`);
    tk.forEach((t) => console.log(`      ticket ${t.id} ${ar(t.createdAt)} · ${t.status} · bruto ${money(t.grossTotal)} · seña aplicada ${money(t.depositAppliedTotal)}`));
  });

  console.log('\n=== SEÑAS RECIBIDAS ===');
  const recibidas = pays.filter((p) => p.type === 'deposit_received');
  recibidas.forEach((p) => {
    const destino = p.bookingId ? (appts.find((a) => (a.bookingId || a.id) === p.bookingId) || null) : null;
    console.log(`  ${ar(p.createdAt)} · ${money(p.amount)} · ${p.method}${p.voided ? ' · ANULADA' : ''}`);
    console.log(`      asignada a la reserva: ${p.bookingId || '(ninguna — queda como saldo suelto)'}${destino ? ` → turno del ${destino.date} · ${destino.service}` : ''}`);
  });

  console.log('\n=== SEÑAS APLICADAS A VENTAS ===');
  pays.filter((p) => p.type === 'deposit_applied').forEach((p) => {
    const t = tickets.find((x) => x.id === p.ticketId);
    const destino = t ? appts.find((a) => (a.bookingId || a.id) === t.reservationId) : null;
    console.log(`  ${ar(p.createdAt)} · ${money(p.amount)}${p.voided ? ' · ANULADA' : ''} · ticket ${p.ticketId || '—'}`);
    console.log(`      se aplicó al turno: ${destino ? `${destino.date} · ${destino.service}` : '(sin turno asociado)'}`);
  });

  const rec = recibidas.filter((p) => !p.voided).reduce((a, p) => a + Number(p.amount || 0), 0);
  const apl = pays.filter((p) => p.type === 'deposit_applied' && !p.voided).reduce((a, p) => a + Number(p.amount || 0), 0);
  console.log('\n=== SALDO DE SEÑAS ===');
  console.log('  recibido', money(rec), '− aplicado', money(apl), '=', money(rec - apl));
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

  // CHEQUEO nombres de cliente en recaudación (con fallback al ticket)
  const ticketById = new Map(tickets.map(t=>[t.id,t]));
  const nombreOk = p => { if(p.clientId) return true; const t=p.ticketId?ticketById.get(p.ticketId):null; return !!(t && (t.clientNameSnapshot || t.clientId)); };
  const sinNombreAntes = rpays.filter(p=>!p.clientId).length;
  const sinNombreAhora = rpays.filter(p=>!nombreOk(p)).length;

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
  console.log('CHEQUEO recaudación sin nombre — ANTES:', sinNombreAntes, '→ AHORA (con fallback ticket):', sinNombreAhora, '/', rpays.length);
}

// audit-turnos-dia — SOLO LECTURA. Reconstruye la agenda de un día con snapshots
// PITR y muestra qué turnos se eliminaron, se cancelaron o se movieron, y en qué
// franja horaria pasó. Un turno eliminado no deja rastro en la base (deleteAppointment
// lo saca del array), así que la única forma de verlo es comparar el pasado contra
// el presente.
// Env: AUDIT_DIA=YYYY-MM-DD (default hoy AR) · AUDIT_PASO=minutos (default 15)
//      AUDIT_FILTRO=regex para destacar (default plasma|prp)
async function auditTurnosDia() {
  const ahora = new Date();
  const hoyAR = new Date(ahora.getTime() - 3*3600e3).toISOString().slice(0,10);
  const DIA = process.env.AUDIT_DIA || hoyAR;
  const PASO = Number(process.env.AUDIT_PASO || 15);
  const FILTRO = new RegExp(process.env.AUDIT_FILTRO || 'plasma|prp', 'i');
  console.log(`=== AGENDA DEL ${DIA} — reconstrucción por PITR (paso ${PASO} min) ===`);

  // Solo los turnos de ESE día: sin el filtro cada snapshot leería la agenda entera
  // y el costo se multiplicaría por la cantidad de snapshots.
  const qDia = db.collection('appointments').where('date', '==', DIA);
  const leerEn = async (when) => {
    try {
      return await db.runTransaction(async (t) => {
        const snap = await t.get(qDia);
        return snap.docs.map(d => d.data());
      }, { readOnly: true, readTime: Timestamp.fromDate(alMinuto(when)) });
    } catch (e) { return null; }
  };

  // Desde las 00:00 AR del día hasta ahora (o hasta el fin del día si es pasado).
  const desde = new Date(`${DIA}T03:00:00Z`);              // 00:00 AR
  const hasta = new Date(Math.min(ahora.getTime() - 60e3, desde.getTime() + 27*3600e3));
  const marcas = [];
  for (let t = desde.getTime(); t <= hasta.getTime(); t += PASO*60e3) marcas.push(new Date(t));
  marcas.push(new Date(ahora.getTime() - 60e3));

  const linea = a => `${a.start||'??'}-${a.end||'??'} · ${a.service||'(sin servicio)'}${a.group?' ['+a.group+']':''} · estado=${a.status||'—'} · id=${a.id}`;
  const horaAR = d => new Date(d.getTime() - 3*3600e3).toISOString().slice(11,16);

  let prev = null, prevWhen = null, snapshots = 0;
  const eventos = [];
  for (const when of marcas) {
    const arr = await leerEn(when);
    if (!arr) continue;                                     // fuera de la ventana PITR
    snapshots++;
    const cur = new Map(arr.map(a => [a.id, a]));
    if (prev) {
      for (const [id, a] of prev) {
        if (!cur.has(id)) { eventos.push({ tipo: 'DESAPARECIÓ', a, desde: prevWhen, hasta: when }); continue; }
        const b = cur.get(id);
        if ((a.status||'') !== (b.status||'')) eventos.push({ tipo: `estado ${a.status||'—'} → ${b.status||'—'}`, a: b, desde: prevWhen, hasta: when });
        if ((a.start||'') !== (b.start||'')) eventos.push({ tipo: `horario ${a.start} → ${b.start}`, a: b, desde: prevWhen, hasta: when });
      }
      for (const [id, b] of cur) if (!prev.has(id)) eventos.push({ tipo: 'se creó', a: b, desde: prevWhen, hasta: when });
    }
    prev = cur; prevWhen = when;
  }
  console.log(`Snapshots leídos: ${snapshots} · turnos en la agenda ahora: ${prev ? prev.size : 0}`);

  if (!eventos.length) { console.log('\nSIN CAMBIOS: ningún turno de ese día se creó, movió, canceló ni eliminó.'); }
  else {
    console.log(`\n=== ${eventos.length} CAMBIO(S) ===`);
    for (const ev of eventos) {
      const marca = FILTRO.test(`${ev.a.service||''} ${ev.a.group||''}`) ? ' ⭐' : '';
      console.log(`\n[${horaAR(ev.desde)}–${horaAR(ev.hasta)} AR] ${ev.tipo}${marca}`);
      console.log('   ', linea(ev.a));
      // Nombre de la clienta y de la colaboradora: se leen de a uno, no la colección entera.
      try {
        if (ev.a.clientId) {
          const c = await db.collection('clients').doc(ev.a.clientId).get();
          const cp = await db.collection('clientsPrivate').doc(ev.a.clientId).get();
          const d = c.exists ? c.data() : {};
          console.log('     clienta:', [d.first, d.last].filter(Boolean).join(' ') || ev.a.clientId,
                      cp.exists ? '· tel ' + (cp.data().phone || '—') : '');
        }
        if (ev.a.memberId) {
          const m = await db.collection('collaborators').doc(ev.a.memberId).get();
          if (m.exists) console.log('     colaboradora:', [m.data().first, m.data().last].filter(Boolean).join(' ') || ev.a.memberId);
        }
      } catch (e) { console.log('     (no se pudo resolver clienta/colaboradora:', String(e.message||e).slice(0,60), ')'); }
      if (ev.a.createdBy) console.log('     lo había creado:', ev.a.createdBy);
      if (ev.tipo === 'DESAPARECIÓ') {
        // ¿Se eliminó de verdad, o lo movieron a otro día? Si sigue existiendo con
        // otra fecha, no fue una eliminación.
        const q = await db.collection('appointments').where('id', '==', ev.a.id).get();
        if (q.empty) console.log('     → ELIMINADO: ya no existe en la base.');
        else console.log('     → NO fue eliminado: lo movieron al', q.docs[0].data().date, q.docs[0].data().start || '');
      }
    }
  }
  console.log('\nNOTA: la app no guarda QUIÉN elimina un turno, así que esto dice qué se');
  console.log('eliminó y en qué franja, pero no el autor. "lo había creado" es quien lo');
  console.log('dio de alta, que puede no ser la misma persona que lo borró.');
}

// buscar-turno-cliente — SOLO LECTURA. "¿Esta clienta tuvo ALGUNA VEZ un turno
// que ya no está?" Busca la clienta por nombre, y para cada una que matchee
// recorre el historial PITR (hasta 7 días, cada 2 horas — la consulta filtra por
// clientId así que cada lectura es barata) y lista TODOS los turnos que existieron
// alguna vez, estén o no ahora, marcando los que coinciden con el día buscado o
// con el filtro de servicio.
// A diferencia de audit-borrados-hoy (que compara únicamente 00:00 de hoy contra
// ahora), esto cubre un turno que se haya borrado en cualquier momento de los
// últimos 7 días, no solo hoy.
// Env: CLIENTE_NOMBRE (obligatorio) · FECHA_TURNO=YYYY-MM-DD (default hoy AR)
//      AUDIT_FILTRO=regex (default plasma|prp) · DIAS_ATRAS (default 7)
async function buscarTurnoCliente() {
  const NOMBRE = (process.env.CLIENTE_NOMBRE || '').trim();
  if (!NOMBRE) { console.log('Falta CLIENTE_NOMBRE.'); return; }
  const ahora = new Date();
  const hoyAR = new Date(ahora.getTime() - 3*3600e3).toISOString().slice(0,10);
  const FECHA = process.env.FECHA_TURNO || hoyAR;
  const FILTRO = new RegExp(process.env.AUDIT_FILTRO || 'plasma|prp', 'i');
  const DIAS = Number(process.env.DIAS_ATRAS || 7);
  const horaAR = d => new Date(d.getTime() - 3*3600e3).toISOString().slice(0,16).replace('T',' ');
  const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  const buscado = norm(NOMBRE);

  console.log(`=== Buscando clienta "${NOMBRE}" ===`);
  const clientsSnap = await db.collection('clients').get();
  const candidatas = clientsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => { const full = norm(`${c.first||''} ${c.last||''}`); return full.includes(buscado) || buscado.split(' ').every(p => full.includes(p)); });

  if (!candidatas.length) { console.log('No se encontró ninguna clienta con ese nombre.'); return; }
  console.log(`${candidatas.length} coincidencia(s): ${candidatas.map(c=>`${c.first||''} ${c.last||''} (id=${c.id})`).join(' · ')}\n`);

  for (const cli of candidatas) {
    console.log(`── ${cli.first||''} ${cli.last||''} (id=${cli.id}) ──`);
    const q = db.collection('appointments').where('clientId', '==', cli.id);
    const erroresVistos = new Map();   // mensaje -> cuántas veces
    const leerEn = async (when) => {
      try {
        return await db.runTransaction(async (t) => {
          const s = await t.get(q);
          return s.docs.map(d => d.data());
        }, { readOnly: true, readTime: Timestamp.fromDate(alMinuto(when)) });
      } catch (e) {
        const msg = String(e.message || e).slice(0, 150);
        erroresVistos.set(msg, (erroresVistos.get(msg) || 0) + 1);
        return null;
      }
    };

    // +1h de margen respecto al límite de retención de PITR: pedir justo el borde
    // tira "read_time is too old".
    const desde = new Date(ahora.getTime() - (DIAS*24 - 1)*3600e3);
    const marcas = [];
    for (let t = desde.getTime(); t < ahora.getTime() - 3600e3; t += 2*3600e3) marcas.push(new Date(t));
    marcas.push(new Date(ahora.getTime() - 60e3));

    const vistos = new Map();   // id -> {primera, ultima, ultimoDato, sigueAhora}
    let snapshotsOk = 0;
    for (const when of marcas) {
      const arr = await leerEn(when);
      if (!arr) continue;
      snapshotsOk++;
      for (const a of arr) {
        if (!vistos.has(a.id)) vistos.set(a.id, { primera: when, ultima: when, dato: a });
        else { const v = vistos.get(a.id); v.ultima = when; v.dato = a; }
      }
    }
    console.log(`  snapshots leídos: ${snapshotsOk}/${marcas.length} (ventana: ${horaAR(desde)} → ahora)`);
    if (erroresVistos.size) {
      console.log('  ⚠ Errores durante la lectura histórica (esto le resta confianza al resultado):');
      for (const [msg, n] of erroresVistos) console.log(`    x${n}: ${msg}`);
    }

    if (!vistos.size) { console.log('  Ningún turno para esta clienta en los últimos', DIAS, 'días.\n'); continue; }

    const actuales = await leerEn(new Date(ahora.getTime() - 30e3)) || [];
    const idsActuales = new Set(actuales.map(a => a.id));

    for (const [id, v] of vistos) {
      const a = v.dato;
      const existe = idsActuales.has(id);
      const marcaFecha = a.date === FECHA ? '  📅 COINCIDE CON LA FECHA BUSCADA' : '';
      const marcaServ = FILTRO.test(`${a.service||''} ${a.group||''}`) ? '  ⭐ COINCIDE CON EL SERVICIO' : '';
      console.log(`\n  · turno ${a.date||'?'} ${a.start||''}-${a.end||''} · ${a.service||'(sin servicio)'}${a.group?' ['+a.group+']':''} · estado=${a.status||'—'}${marcaFecha}${marcaServ}`);
      console.log(`    id=${id} · ${existe ? 'SIGUE EXISTIENDO ahora' : 'YA NO EXISTE — se eliminó'}`);
      if (!existe) {
        // Acotar la franja de borrado por búsqueda binaria entre la última vez
        // que se lo vio y ahora.
        let lo = v.ultima.getTime(), hi = ahora.getTime() - 30e3;
        const existeEn = async (ms) => {
          try {
            return await db.runTransaction(async (t) => {
              const s = await t.get(db.collection('appointments').where('id', '==', id));
              return !s.empty;
            }, { readOnly: true, readTime: Timestamp.fromDate(alMinuto(new Date(ms))) });
          } catch (e) { return null; }
        };
        for (let i = 0; i < 8 && hi - lo > 60e3; i++) {
          const mid = Math.floor((lo + hi) / 2);
          const r = await existeEn(mid);
          if (r === null) break;
          if (r) lo = mid; else hi = mid;
        }
        console.log(`    → se eliminó entre las ${horaAR(new Date(lo))} y las ${horaAR(new Date(hi))} hora AR`);
      }
    }
    console.log('');
  }
  console.log('NOTA: la app no registra QUIÉN elimina un turno, solo cuándo dejó de existir.');
}

// fix-sena-fecha [-apply] — Devuelve a un pago de seña su fecha REAL, la que
// tenía antes de que una edición de turno lo borrara y lo recreara con la fecha
// del día de la edición.
// La fecha original NO se escribe a mano: se busca en el historial PITR el pago
// de seña del mismo cliente, mismo monto y mismo medio de pago que existía antes
// y ya no está. Si no la encuentra, no toca nada.
// Informa además si alguno de los dos días tiene cierre de caja hecho, porque
// mover la fecha cambia el efectivo esperado de esos días.
// Env: SENA_PAGO_ID (obligatorio, el pago con la fecha equivocada)
async function fixSenaFecha() {
  const APPLY = MODE.endsWith('-apply');
  const PAGO_ID = (process.env.SENA_PAGO_ID || '').trim();
  if (!PAGO_ID) { console.log('Falta SENA_PAGO_ID.'); return; }
  const ahora = new Date();
  const diaAR = iso => { const d = new Date(iso); return isNaN(d) ? '' : new Date(d.getTime()-3*3600e3).toISOString().slice(0,10); };
  const arStr = iso => { const d = new Date(iso); return isNaN(d) ? String(iso) : new Date(d.getTime()-3*3600e3).toISOString().slice(0,16).replace('T',' '); };

  console.log(`=== ${APPLY ? 'APLICAR' : 'SIMULACIÓN'} — devolver su fecha real a la seña ${PAGO_ID} ===\n`);

  const snap = await db.collection('payments').where('id', '==', PAGO_ID).get();
  if (snap.empty) { console.log('No existe ese pago.'); return; }
  if (snap.size > 1) { console.log('Hay más de un pago con ese id — freno por las dudas.'); return; }
  const ref = snap.docs[0].ref, pago = snap.docs[0].data();
  console.log('PAGO ACTUAL:');
  console.log(`  ${pago.amount} · ${pago.method||'?'} · type=${pago.type} · cliente=${pago.clientId}`);
  console.log(`  createdAt = ${pago.createdAt}  (${arStr(pago.createdAt)} AR)\n`);
  if (pago.type !== 'deposit_received') { console.log('No es una seña (deposit_received). Freno.'); return; }

  // Buscar en el historial el pago que fue reemplazado: mismo cliente, mismo
  // monto, mismo método, id distinto, y que hoy ya no exista.
  const q = db.collection('payments').where('clientId', '==', pago.clientId);
  const leerEn = async (when) => {
    try {
      return await db.runTransaction(async (t) => {
        const s = await t.get(q);
        return s.docs.map(d => d.data());
      }, { readOnly: true, readTime: Timestamp.fromDate(alMinuto(when)) });
    } catch (e) { return null; }
  };
  const actuales = new Set((await leerEn(new Date(ahora.getTime()-60e3)) || []).map(p => p.id));
  let original = null, vistoEn = null;
  for (let t = ahora.getTime() - (7*24 - 1)*3600e3; t < ahora.getTime() - 3600e3; t += 2*3600e3) {
    const arr = await leerEn(new Date(t));
    if (!arr) continue;
    const cand = arr.find(p => p.type === 'deposit_received' && !p.voided
      && p.id !== pago.id && !actuales.has(p.id)
      && Math.abs(Number(p.amount||0) - Number(pago.amount||0)) < 0.5
      && (p.method||'') === (pago.method||''));
    if (cand) { original = cand; vistoEn = new Date(t); break; }
  }
  if (!original) { console.log('No encontré en el historial un pago equivalente que haya sido reemplazado. NO TOCO NADA.'); return; }

  console.log('PAGO ORIGINAL ENCONTRADO EN EL HISTORIAL:');
  console.log(`  id=${original.id} · ${original.amount} · ${original.method} · visto el ${arStr(vistoEn.toISOString())} AR`);
  console.log(`  createdAt = ${original.createdAt}  (${arStr(original.createdAt)} AR)\n`);

  const diaViejo = diaAR(original.createdAt), diaActual = diaAR(pago.createdAt);
  if (diaViejo === diaActual) { console.log('Los dos createdAt caen el mismo día: no hay nada que corregir.'); return; }

  console.log('CAMBIO PROPUESTO:');
  console.log(`  createdAt: ${pago.createdAt}  →  ${original.createdAt}`);
  console.log(`  el ingreso se mueve del ${diaActual} al ${diaViejo}\n`);

  // Impacto en los cierres de caja de ambos días.
  const cierres = (await db.collection('cashClosings').get()).docs.map(d => d.data());
  const esEfectivo = /efectivo/i.test(pago.method || '');
  console.log('IMPACTO EN CAJA:');
  console.log(`  medio de pago: ${pago.method}${esEfectivo ? ' → SÍ afecta el efectivo esperado' : ' → no afecta el efectivo en mano'}`);
  for (const [dia, signo] of [[diaActual, `-${pago.amount}`], [diaViejo, `+${pago.amount}`]]) {
    const c = cierres.find(x => x.closedAt && diaAR(x.closedAt) === dia);
    console.log(`  ${dia}: ${c ? `TIENE CIERRE HECHO (contado ${c.countedCash ?? '?'}) — su efectivo esperado cambia en ${signo}` : 'sin cierre registrado'}`);
  }
  console.log('');

  if (!APPLY) { console.log('SIMULACIÓN: no se escribió nada. Para aplicar, MODE=fix-sena-fecha-apply'); return; }
  await ref.update({ createdAt: original.createdAt, fechaCorregidaDesde: pago.createdAt, fechaCorregidaEl: new Date().toISOString() });
  const despues = (await ref.get()).data();
  console.log('APLICADO. Estado después:');
  console.log(`  createdAt = ${despues.createdAt}  (${arStr(despues.createdAt)} AR)`);
  console.log(`  se dejó registro en fechaCorregidaDesde = ${despues.fechaCorregidaDesde}`);
}

// inspect-sena-cliente — SOLO LECTURA. Reconstruye la historia de las señas de
// una clienta. Al editar un turno, el guardado BORRA el pago de seña de esa
// reserva y lo vuelve a crear con addPayment(), que sin createdAt explícito lo
// fecha HOY: la plata que entró hace días pasa a figurar como ingreso de hoy y
// descuadra el efectivo esperado de la caja.
// Recorre el historial PITR y muestra, por cada snapshot, los pagos de seña que
// existían con su id y su createdAt, para poder ver el momento exacto en que un
// id desapareció y otro nació con fecha nueva — y recuperar así la fecha real.
// Env: CLIENTE_NOMBRE (obligatorio) · DIAS_ATRAS (default 7) · PASO_HORAS (default 2)
async function inspectSenaCliente() {
  const NOMBRE = (process.env.CLIENTE_NOMBRE || '').trim();
  if (!NOMBRE) { console.log('Falta CLIENTE_NOMBRE.'); return; }
  const ahora = new Date();
  const DIAS = Number(process.env.DIAS_ATRAS || 7);
  const PASO = Number(process.env.PASO_HORAS || 2);
  const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  const buscado = norm(NOMBRE);
  const arStr = iso => { const d = new Date(iso); return isNaN(d) ? String(iso) : new Date(d.getTime()-3*3600e3).toISOString().slice(0,16).replace('T',' '); };

  const clientsSnap = await db.collection('clients').get();
  const candidatas = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(c => { const full = norm(`${c.first||''} ${c.last||''}`); return full.includes(buscado) || buscado.split(' ').every(p => full.includes(p)); });
  if (!candidatas.length) { console.log('No se encontró la clienta.'); return; }
  console.log(`=== Señas de "${NOMBRE}" — ${candidatas.length} coincidencia(s) ===\n`);

  for (const cli of candidatas) {
    console.log(`── ${cli.first||''} ${cli.last||''} (id=${cli.id}) ──`);
    const q = db.collection('payments').where('clientId', '==', cli.id);
    const errores = new Map();
    const leerEn = async (when) => {
      try {
        return await db.runTransaction(async (t) => {
          const s = await t.get(q);
          return s.docs.map(d => d.data());
        }, { readOnly: true, readTime: Timestamp.fromDate(alMinuto(when)) });
      } catch (e) { const m = String(e.message||e).slice(0,120); errores.set(m,(errores.get(m)||0)+1); return null; }
    };
    const senas = arr => (arr||[]).filter(p => p.type === 'deposit_received');

    // Estado actual
    const hoyArr = await leerEn(new Date(ahora.getTime() - 60e3));
    console.log('\n  ESTADO ACTUAL:');
    if (!hoyArr) console.log('    (no se pudo leer)');
    else if (!senas(hoyArr).length) console.log('    sin señas registradas');
    else senas(hoyArr).forEach(p => console.log(`    · id=${p.id} · ${p.amount} · ${p.method||'?'} · createdAt=${arStr(p.createdAt)} AR · booking=${p.bookingId||'—'}${p.voided?' · ANULADO':''}`));

    // Historia: solo se imprime cuando el conjunto de (id, createdAt) cambia.
    console.log('\n  HISTORIA (solo los momentos en que cambió):');
    const marcas = [];
    for (let t = ahora.getTime() - (DIAS*24 - 1)*3600e3; t < ahora.getTime() - 3600e3; t += PASO*3600e3) marcas.push(new Date(t));
    let firma = null, ok = 0;
    for (const when of marcas) {
      const arr = await leerEn(when);
      if (!arr) continue;
      ok++;
      const s = senas(arr);
      const f = s.map(p => `${p.id}|${p.amount}|${p.createdAt}`).sort().join(',');
      if (f !== firma) {
        console.log(`\n   [${arStr(when.toISOString())} AR] ${s.length} seña(s):`);
        s.forEach(p => console.log(`      · id=${p.id} · ${p.amount} · ${p.method||'?'} · createdAt=${arStr(p.createdAt)} AR${p.voided?' · ANULADO':''}`));
        if (!s.length) console.log('      (ninguna)');
        firma = f;
      }
    }
    console.log(`\n  snapshots leídos: ${ok}/${marcas.length}`);
    if (errores.size) { console.log('  ⚠ errores de lectura:'); for (const [m,n] of errores) console.log(`    x${n}: ${m}`); }
    console.log('');
  }
  console.log('CÓMO LEERLO: si un id desaparece y aparece otro con createdAt más nuevo,');
  console.log('esa seña fue borrada y recreada al editar el turno. El createdAt viejo es');
  console.log('la fecha REAL en que entró la plata.');
}

// audit-borrados-hoy — SOLO LECTURA. Responde "¿se borró algún turno hoy?" sin
// importar para qué día era el turno (audit-turnos-dia solo mira la agenda de un
// día, así que se le escapa un turno futuro borrado hoy).
// Compara la colección entera al inicio del día contra ahora — dos lecturas — y
// para cada turno que falte acota por búsqueda binaria la franja en que
// desapareció (~6 lecturas más, en vez de un snapshot cada 15 minutos).
async function auditBorradosHoy() {
  const ahora = new Date();
  const hoyAR = new Date(ahora.getTime() - 3*3600e3).toISOString().slice(0,10);
  const DIA = process.env.AUDIT_DIA || hoyAR;
  const FILTRO = new RegExp(process.env.AUDIT_FILTRO || 'plasma|prp', 'i');
  const desde = new Date(`${DIA}T03:00:00Z`);                       // 00:00 AR
  const hasta = new Date(Math.min(ahora.getTime() - 60e3, desde.getTime() + 27*3600e3));
  const horaAR = d => new Date(d.getTime() - 3*3600e3).toISOString().slice(11,16);
  console.log(`=== TURNOS BORRADOS EL ${DIA} (cualquier fecha de turno) ===`);
  console.log(`Ventana: ${horaAR(desde)} → ${horaAR(hasta)} hora AR\n`);

  const todoEn = async (when) => {
    try {
      return await db.runTransaction(async (t) => {
        const s = await t.get(db.collection('appointments'));
        return s.docs.map(d => d.data());
      }, { readOnly: true, readTime: Timestamp.fromDate(alMinuto(when)) });
    } catch (e) { console.log('  (no se pudo leer a las', horaAR(when), '—', String(e.message||e).slice(0,80), ')'); return null; }
  };

  const A = await todoEn(desde), B = await todoEn(hasta);
  if (!A || !B) { console.log('FALLÓ la lectura histórica: sin esto no puedo afirmar nada.'); return; }
  const mapA = new Map(A.map(a => [a.id, a])), mapB = new Map(B.map(a => [a.id, a]));
  const borrados = [...mapA.values()].filter(a => !mapB.has(a.id));
  const creados  = [...mapB.values()].filter(a => !mapA.has(a.id));

  // Validación del mecanismo: si detecta altas, es que está leyendo el pasado de
  // verdad. Sin esto, un "no hay borrados" podría ser simplemente una lectura rota.
  console.log(`Turnos en la base a las ${horaAR(desde)}: ${A.length} · ahora: ${B.length}`);
  console.log(`Altas detectadas hoy: ${creados.length} · bajas detectadas hoy: ${borrados.length}`);
  console.log(creados.length
    ? `CONTROL OK: la lectura del historial funciona (detectó ${creados.length} alta/s).`
    : 'CONTROL SIN CONFIRMAR: hoy no hubo altas, así que no puedo probar por esta vía que la lectura detecte cambios.');

  if (!borrados.length) { console.log('\nRESULTADO: no se borró ningún turno hoy.'); }
  for (const a of borrados) {
    const marca = FILTRO.test(`${a.service||''} ${a.group||''}`) ? '  ⭐ COINCIDE CON LA BÚSQUEDA' : '';
    console.log(`\n── BORRADO${marca}`);
    console.log(`   turno del ${a.date||'?'} ${a.start||''}-${a.end||''} · ${a.service||'(sin servicio)'}${a.group?' ['+a.group+']':''} · estado=${a.status||'—'}`);
    console.log(`   id=${a.id}${a.createdBy?' · lo había creado: '+a.createdBy:''}`);
    try {
      if (a.clientId) {
        const c = await db.collection('clients').doc(a.clientId).get();
        const cp = await db.collection('clientsPrivate').doc(a.clientId).get();
        const d = c.exists ? c.data() : {};
        console.log('   clienta:', [d.first, d.last].filter(Boolean).join(' ') || a.clientId, cp.exists ? '· tel ' + (cp.data().phone || '—') : '');
      }
      if (a.memberId) {
        const m = await db.collection('collaborators').doc(a.memberId).get();
        if (m.exists) console.log('   colaboradora:', [m.data().first, m.data().last].filter(Boolean).join(' ') || a.memberId);
      }
    } catch (e) { console.log('   (no se pudo resolver clienta/colaboradora)'); }
    // Búsqueda binaria de la franja: existía en `lo`, ya no en `hi`.
    let lo = desde.getTime(), hi = hasta.getTime();
    const existeEn = async (ms) => {
      try {
        return await db.runTransaction(async (t) => {
          const s = await t.get(db.collection('appointments').where('id', '==', a.id));
          return !s.empty;
        }, { readOnly: true, readTime: Timestamp.fromDate(alMinuto(new Date(ms))) });
      } catch (e) { return null; }
    };
    for (let i = 0; i < 7 && hi - lo > 60e3; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const r = await existeEn(mid);
      if (r === null) break;
      if (r) lo = mid; else hi = mid;
    }
    console.log(`   → se borró entre las ${horaAR(new Date(lo))} y las ${horaAR(new Date(hi))} hora AR`);
  }
  console.log('\nNOTA: la app no registra QUIÉN elimina un turno. Esto dice qué se borró');
  console.log('y en qué franja; el autor hay que deducirlo de quién estaba en ese horario.');
}

(async () => {
  if (MODE === 'fix-sena-fecha' || MODE === 'fix-sena-fecha-apply') { await fixSenaFecha(); return; }
  if (MODE === 'inspect-sena-cliente') { await inspectSenaCliente(); return; }
  if (MODE === 'buscar-turno-cliente') { await buscarTurnoCliente(); return; }
  if (MODE === 'audit-borrados-hoy') { await auditBorradosHoy(); return; }
  if (MODE === 'audit-turnos-dia') { await auditTurnosDia(); return; }
  if (MODE === 'inspect') { await inspect(); return; }
  if (MODE === 'inspect-commissions') { await inspectCommissions(); return; }
  if (MODE === 'simulate-commissions') { await simulateCommissions(); return; }
  if (MODE === 'inspect-reportes') { await inspectReportes(); return; }
  if (MODE === 'inspect-retention') { await inspectRetention(); return; }
  if (MODE === 'seed-retention-guards' || MODE === 'seed-retention-guards-apply') { await seedRetentionGuards(); return; }
  if (MODE === 'inspect-liq-finance') { await inspectLiqFinance(); return; }
  if (MODE === 'fix-liq-expenses' || MODE === 'fix-liq-expenses-apply') { await fixLiqExpenses(); return; }
  if (MODE === 'inspect-caja') { await inspectCaja(); return; }
  if (MODE === 'audit-caja') { await auditCaja(); return; }
  if (MODE === 'audit-fechas') { await auditFechas(); return; }
  if (MODE === 'inspect-turno') { await inspectTurno(); return; }
  if (MODE === 'inspect-senas') { await inspectSenas(); return; }
  if (MODE === 'anular-ticket' || MODE === 'anular-ticket-apply') { await anularTicket(); return; }
  if (MODE === 'audit-retiros') { await auditRetiros(); return; }
  if (MODE === 'fix-caja-openedat' || MODE === 'fix-caja-openedat-apply') { await fixCajaOpenedAt(); return; }
  if (MODE === 'fix-retiro-huerfano' || MODE === 'fix-retiro-huerfano-apply') { await fixRetiroHuerfano(); return; }
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
