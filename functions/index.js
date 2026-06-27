/**
 * GLAMB OS — Recordatorios automáticos (lado servidor)
 *
 * Antes los recordatorios solo se enviaban si alguien tenía la app abierta
 * (el chequeo corría en el navegador). Esta función programada corre en el
 * servidor cada 15 minutos, así los recordatorios salen SIEMPRE, esté la app
 * abierta o no.
 *
 * Hoy envía el recordatorio por EMAIL (escribe en la colección `mail`, que la
 * extensión Trigger Email entrega). Queda lista para sumar WhatsApp cuando el
 * número dedicado + API de Meta estén configurados.
 *
 * Deduplicación: cada recordatorio enviado se registra en `sentReminders/{id}`
 * para no enviarlo dos veces.
 */
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SKIP_STATUS = ["cancelled", "cancelado", "voided", "completed", "no_show"];

function fillTemplate(str, vars) {
  return (str || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
}

// Fecha calendario AR (UTC-3) de hoy y mañana, en formato YYYY-MM-DD.
function argentinaDates() {
  const pad = (n) => String(n).padStart(2, "0");
  const ar = new Date(Date.now() - 3 * 3600000); // desplazar a hora AR usando partes UTC
  const y = ar.getUTCFullYear();
  const m = ar.getUTCMonth();
  const d = ar.getUTCDate();
  const today = `${y}-${pad(m + 1)}-${pad(d)}`;
  const t = new Date(Date.UTC(y, m, d + 1));
  const tomorrow = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  return {today, tomorrow};
}

exports.sendAppointmentReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "America/Argentina/Buenos_Aires",
    region: "southamerica-east1",
  },
  async () => {
    // 1) Plantillas y nombre del local: ahora viven en appState/config
    //    (se movieron del blob compartido para que un equipo con copia vieja no
    //    las pisara). Respaldo a appState/main por compatibilidad con datos viejos.
    const [cfgSnap, blobSnap] = await Promise.all([
      db.doc("appState/config").get(),
      db.doc("appState/main").get(),
    ]);
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    const blob = blobSnap.exists ? blobSnap.data() : {};
    const comms = (cfg && cfg.comms) || (blob && blob.comms) || {};
    const tpl = (comms.templates || {}).preEmail;
    if (!tpl || tpl.enabled === false) {
      console.log("preEmail deshabilitado; nada que enviar.");
      return;
    }
    const bizName = comms.bizName || "GLAMB";
    const hoursBefore = Number(tpl.hoursBeforeEmail || 4);
    const now = Date.now();

    // 2) Turnos de hoy/mañana (rango chico; el filtro fino es por hora)
    const {today, tomorrow} = argentinaDates();
    const snap = await db
      .collection("appointments")
      .where("date", ">=", today)
      .where("date", "<=", tomorrow)
      .get();

    let sent = 0;
    for (const doc of snap.docs) {
      const a = doc.data() || {};
      if (a.isAdditional) continue;
      if (a.status && SKIP_STATUS.includes(a.status)) continue;
      if (!a.date || !a.start || !a.clientId) continue;

      // Instante del turno en hora AR (UTC-3)
      const apptTime = Date.parse(`${a.date}T${a.start}:00-03:00`);
      if (isNaN(apptTime)) continue;

      // Ventana: dentro de las N horas previas y todavía no empezó
      if (now < apptTime - hoursBefore * 3600000) continue; // demasiado temprano
      if (now >= apptTime) continue; // ya pasó / en curso

      // Deduplicación
      const sentRef = db.doc(`sentReminders/${doc.id}_preEmail`);
      if ((await sentRef.get()).exists) continue;

      // Email del cliente: clientsPrivate tiene prioridad (Fase B)
      const cId = a.clientId;
      const [cSnap, cpSnap] = await Promise.all([
        db.doc(`clients/${cId}`).get(),
        db.doc(`clientsPrivate/${cId}`).get(),
      ]);
      const c = cSnap.exists ? cSnap.data() : {};
      const email = (cpSnap.exists && cpSnap.data().email) || c.email || "";
      if (!email) continue;

      // Variables de plantilla (mismas que usa la app, sin la colaboradora)
      const [Y, M, D] = a.date.split("-").map(Number);
      const dow = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
      const vars = {
        nombre: c.first || "",
        apellido: c.last || "",
        servicio: a.service || "",
        hora: a.start || "",
        bizName,
        fecha: `${DAY_NAMES[dow]} ${D} de ${MONTH_NAMES[M - 1]}`,
      };
      const subject = fillTemplate(tpl.subject || "", vars);
      const body = fillTemplate(tpl.body || "", vars);
      const html = body.replace(/\n/g, "<br>");

      // Encolar el email (la extensión Trigger Email lo entrega)
      await db.collection("mail").add({
        to: [email],
        message: {subject, html, text: body},
        createdAt: FieldValue.serverTimestamp(),
      });
      await sentRef.set({
        apptId: doc.id,
        type: "preEmail",
        email,
        sentAt: FieldValue.serverTimestamp(),
      });
      sent++;
    }
    console.log(`Recordatorios por email enviados: ${sent}`);
  }
);
