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

/**
 * Copia del consentimiento firmado por email.
 *
 * Se dispara cuando un documento de `consentForms` pasa a estado "signed".
 * Corre en el servidor a propósito: la página pública (consentimiento.html) NO
 * tiene permiso para escribir en la colección `mail`, así nadie puede usar el
 * link para mandar correos desde el dominio del salón. El email de la clienta
 * se busca acá (vive en `clientsPrivate`, que solo lee el admin).
 *
 * Idempotente: marca `emailCopySent` para no reenviar si el documento se toca
 * de nuevo.
 */
const {onDocumentUpdated} = require("firebase-functions/v2/firestore");

const RISK_MARK = " ⚠";

function labelOf(question, value) {
  const opt = (question.options || []).find((o) => o.v === value);
  return opt ? opt.label : value;
}
function isRisk(question, value) {
  const opt = (question.options || []).find((o) => o.v === value);
  return !!(opt && opt.risk);
}

// Arma el cuerpo del email desde el SNAPSHOT guardado (no desde la plantilla
// actual): la copia refleja exactamente lo que la clienta aceptó ese día.
function buildConsentEmail(data) {
  const snap = data.snapshot || {};
  const answers = data.answers || {};
  const esc = (s) => String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let rows = "";
  (snap.sections || []).forEach((sec) => {
    rows += `<tr><td colspan="2" style="padding:14px 0 4px;font-weight:700;color:#7a6350">${esc(sec.title || "")}</td></tr>`;
    (sec.questions || []).forEach((q) => {
      const v = answers[q.id];
      let val = "—";
      let risky = false;
      if (Array.isArray(v)) {
        val = v.map((x) => {
          if (isRisk(q, x)) risky = true;
          return esc(labelOf(q, x));
        }).join(", ") || "—";
      } else if (v !== undefined && v !== "") {
        risky = isRisk(q, v);
        val = esc(labelOf(q, v));
      }
      rows += `<tr><td style="padding:6px 10px 6px 0;color:#666;border-bottom:1px solid #eee">${esc(q.label || "")}</td>` +
        `<td style="padding:6px 0;text-align:right;font-weight:600;border-bottom:1px solid #eee;${risky ? "color:#c0392b" : ""}">${val}${risky ? RISK_MARK : ""}</td></tr>`;
    });
  });

  const rep = data.representante;
  const minorBlock = data.isMinor && rep ?
    `<div style="background:#f6e2e0;border-radius:10px;padding:12px 14px;margin:14px 0;font-size:13px">
       <b>Menor de edad — firmó su representante legal</b><br>
       ${esc(rep.nombre || "")} · DNI ${esc(rep.dni || "")} · ${esc(rep.vinculo || "")}
     </div>` : "";

  const firmado = data.signedAt ? new Date(data.signedAt).toLocaleString("es-AR") : "";

  // Cuidados previos y política: se repiten en la copia para que la clienta los
  // tenga a mano antes del turno (no todas vuelven a abrir el link).
  const pc = snap.preCare;
  const careBlock = pc && (pc.groups || []).length ?
    `<h3 style="font-size:14px;margin:20px 0 6px;color:#7a6350">${esc(pc.title || "Cuidados previos")}</h3>` +
    (pc.intro ? `<div style="font-size:12.5px;color:#888;margin-bottom:8px">${esc(pc.intro)}</div>` : "") +
    (pc.groups || []).map((g) =>
      `<div style="margin-top:10px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9c8266;font-weight:700">${esc(g.t || "")}</div>` +
      `<ul style="margin:4px 0 0;padding-left:18px;font-size:12.5px;color:#5d564e">` +
      (g.items || []).map((i) => `<li style="margin-bottom:3px">${esc(i)}</li>`).join("") +
      `</ul></div>`).join("") : "";

  const policyBlock = snap.policy && snap.policy.text ?
    `<div style="background:#f6e2e0;border-left:4px solid #cf8b83;border-radius:10px;padding:12px 14px;margin:18px 0;font-size:12.5px;line-height:1.6">
       <b style="color:#8a3b34;display:block;margin-bottom:3px">${esc(snap.policy.title || "Política de turnos")}</b>
       ${esc(snap.policy.text)}
     </div>` : "";

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#2a2521;max-width:620px;line-height:1.6">
    <div style="text-align:center;padding:18px 0;border-bottom:1px solid #e6dccd">
      <div style="font-size:26px;letter-spacing:7px;color:#2a2521">GLAMB</div>
      <div style="font-size:10px;letter-spacing:3px;color:#9c8266;text-transform:uppercase">Belgrano</div>
    </div>
    <h2 style="font-weight:400;font-size:19px;margin:18px 0 4px">${esc(snap.title || "Consentimiento informado")}</h2>
    <div style="font-size:12px;color:#888;margin-bottom:6px">${esc(data.clientName || "")}${data.clientDni ? " · DNI " + esc(data.clientDni) : ""} · Firmado el ${esc(firmado)}</div>
    ${minorBlock}
    <table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>
    ${careBlock}
    ${policyBlock}
    <h3 style="font-size:14px;margin:20px 0 6px;color:#7a6350">Texto aceptado</h3>
    <div style="font-size:12.5px;color:#5d564e;white-space:pre-line;background:#f6f1ea;border-radius:10px;padding:14px">${esc(snap.consentText || "")}</div>
    <h3 style="font-size:14px;margin:20px 0 6px;color:#7a6350">Firma</h3>
    ${data.signature ? `<img src="${data.signature}" alt="Firma" style="max-width:280px;border:1px solid #e6dccd;border-radius:8px;background:#fff">` : ""}
    <div style="font-size:11px;color:#888;margin-top:4px">${esc(data.signerName || "")} · ${esc(firmado)}</div>
    <p style="font-size:11px;color:#aaa;margin-top:24px;border-top:1px solid #e6dccd;padding-top:12px">
      Esta es tu copia del consentimiento que firmaste. Guardala. Ante cualquier duda, escribinos.
    </p>
  </div>`;

  const text = `${snap.title || "Consentimiento"} — firmado el ${firmado} por ${data.signerName || ""}. ` +
    "Esta es tu copia. Ante cualquier duda, escribinos.";

  return {subject: `GLAMB · Copia de tu ${snap.title || "consentimiento"}`, html, text};
}

exports.sendConsentCopy = onDocumentUpdated(
    {document: "consentForms/{id}", region: "southamerica-east1"},
    async (event) => {
      const before = event.data.before.data() || {};
      const after = event.data.after.data() || {};
      // Solo al pasar a firmado, y una sola vez.
      if (before.status === "signed" || after.status !== "signed") return;
      if (after.emailCopySent) return;

      let email = "";
      try {
        const priv = await db.collection("clientsPrivate").doc(String(after.clientId)).get();
        email = (priv.exists && priv.data().email) || "";
      } catch (e) {
        console.error("No se pudo leer el email de la clienta:", e);
      }
      if (!email) {
        console.log(`Consentimiento ${event.params.id} firmado, pero la clienta no tiene email cargado.`);
        await event.data.after.ref.set({emailCopySent: false, emailCopyError: "sin email"}, {merge: true});
        return;
      }

      const msg = buildConsentEmail(after);
      await db.collection("mail").add({
        to: [email],
        message: msg,
        createdAt: FieldValue.serverTimestamp(),
      });
      await event.data.after.ref.set({emailCopySent: true}, {merge: true});
      console.log(`Copia del consentimiento ${event.params.id} enviada a ${email}`);
    },
);

/**
 * Invitación por email al crear un consentimiento.
 *
 * Corre en el servidor para que CUALQUIER rol pueda enviar el formulario sin
 * tener acceso al email de la clienta: el email vive en `clientsPrivate`, que
 * solo lee el admin. La colaboradora crea el documento con
 * `sendEmailOnCreate: true` y esta función busca el email y envía el link.
 *
 * Si la clienta no tiene email cargado, marca `inviteStatus: 'no_email'` para
 * que la app avise que hay que pasar el link por WhatsApp.
 */
const {onDocumentCreated} = require("firebase-functions/v2/firestore");

const CONSENT_BASE_URL = "https://glamb-os.web.app/consentimiento.html";

exports.sendConsentInvite = onDocumentCreated(
    {document: "consentForms/{id}", region: "southamerica-east1"},
    async (event) => {
      const snapDoc = event.data;
      if (!snapDoc) return;
      const data = snapDoc.data() || {};
      if (!data.sendEmailOnCreate) return;
      if (data.inviteStatus) return; // ya procesado

      const esc = (s) => String(s == null ? "" : s)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

      let email = "";
      try {
        const priv = await db.collection("clientsPrivate").doc(String(data.clientId)).get();
        email = (priv.exists && priv.data().email) || "";
      } catch (e) {
        console.error("No se pudo leer el email de la clienta:", e);
      }
      if (!email) {
        await snapDoc.ref.set({inviteStatus: "no_email"}, {merge: true});
        console.log(`Consentimiento ${event.params.id}: la clienta no tiene email cargado.`);
        return;
      }

      const url = `${CONSENT_BASE_URL}?t=${encodeURIComponent(event.params.id)}`;
      const nombre = String(data.clientName || "").split(" ")[0];
      const titulo = data.templateTitle || "Consentimiento";
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#2a2521;line-height:1.6;max-width:560px">
        <div style="text-align:center;padding:16px 0;border-bottom:1px solid #e6dccd">
          <div style="font-size:24px;letter-spacing:7px">GLAMB</div>
          <div style="font-size:10px;letter-spacing:3px;color:#9c8266;text-transform:uppercase">Belgrano</div>
        </div>
        <p>Hola ${esc(nombre)},</p>
        <p>Antes de tu turno necesitamos que completes y firmes este formulario. Te lleva 2 minutos desde el celular:</p>
        <p style="text-align:center;margin:22px 0">
          <a href="${url}" style="background:#9c8266;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:600">Completar y firmar</a>
        </p>
        <p style="font-size:12px;color:#777">Si el botón no funciona, copiá este enlace:<br>${url}</p>
        <p style="font-size:12px;color:#777">El enlace vence en 30 días.</p>
        <p>¡Gracias!<br>GLAMB Belgrano</p>
      </div>`;

      await db.collection("mail").add({
        to: [email],
        message: {
          subject: `GLAMB · ${titulo}`,
          html,
          text: `Hola ${nombre}, completá y firmá tu formulario antes del turno: ${url}`,
        },
        createdAt: FieldValue.serverTimestamp(),
      });
      await snapDoc.ref.set({inviteStatus: "sent"}, {merge: true});
      console.log(`Invitación de consentimiento ${event.params.id} enviada a ${email}`);
    },
);

/**
 * Emails de reactivación ("¿Cuándo nos volvemos a ver?").
 *
 * Antes esto corría en el NAVEGADOR: cada dispositivo con la app abierta hacía
 * su propia ronda de envíos. Con varios equipos abiertos a la vez ninguno veía
 * lo que ya había enviado el otro y la misma clienta recibía el mail 6 veces
 * en dos minutos. Además el registro anti-duplicados vivía en una lista tope
 * 100 compartida con los otros recordatorios: se llenaba en ~5 días, se
 * olvidaba, y la clienta volvía a recibirlo.
 *
 * Ahora corre UNA vez por día en el servidor, y el "ya le escribí" vive en un
 * documento por clienta (sentReminders/retention_<clientId>), que no se borra
 * ni se pisa. Dos candados:
 *   1) una sola vez por ausencia (clave: la fecha de su último turno);
 *   2) nunca dos veces a la misma clienta dentro de COOLDOWN_DAYS.
 * El guardado se hace ANTES de encolar el mail: si algo falla, se pierde un
 * envío (recuperable a mano) y nunca se duplica.
 */
const RETENTION_SCHEDULE_REV = 2; // fuerza el redespliegue para crear la tarea programada
const RETENTION_COOLDOWN_DAYS = 90;
const RETENTION_MAX_PER_RUN = 40;

exports.sendRetentionEmails = onSchedule(
    {
      schedule: "every day 11:00",
      timeZone: "America/Argentina/Buenos_Aires",
      region: "southamerica-east1",
    },
    async () => {
      const [cfgSnap, blobSnap] = await Promise.all([
        db.doc("appState/config").get(),
        db.doc("appState/main").get(),
      ]);
      const cfg = cfgSnap.exists ? cfgSnap.data() : {};
      const blob = blobSnap.exists ? blobSnap.data() : {};
      const comms = (cfg && cfg.comms) || (blob && blob.comms) || {};
      const tpl = (comms.templates || {}).retention;
      if (!tpl || tpl.enabled === false) {
        console.log("Reactivación deshabilitada; nada que enviar.");
        return;
      }
      const bizName = comms.bizName || "GLAMB";
      const daysAfter = Number(tpl.daysAfter || 27);
      const {today} = argentinaDates();
      const cutoff = new Date(Date.now() - daysAfter * 86400000).toISOString().slice(0, 10);

      // Turnos: se leen una vez por día. Se descartan los anulados y los
      // adicionales, igual que hacía la app.
      const apptSnap = await db.collection("appointments")
          .select("clientId", "date", "status", "isAdditional", "service").get();
      const lastByClient = {};   // clientId -> fecha del último turno pasado
      const activeClients = new Set(); // con turno reciente o futuro: no molestar
      apptSnap.docs.forEach((d) => {
        const a = d.data() || {};
        if (a.isAdditional) return;
        if (a.status && ["cancelled", "cancelado", "voided"].includes(a.status)) return;
        if (!a.clientId || !a.date) return;
        if (a.date > cutoff) { activeClients.add(a.clientId); return; }
        if (a.date <= today && (!lastByClient[a.clientId] || a.date > lastByClient[a.clientId])) {
          lastByClient[a.clientId] = a.date;
        }
      });

      // Envíos manuales hechos desde la app (quedan en comms.sentLog): se
      // respetan para no pisarlos con uno automático.
      const manual = new Set((comms.sentLog || [])
          .filter((e) => e.type === "retention")
          .map((e) => e.apptId));

      const candidates = Object.keys(lastByClient).filter((id) => !activeClients.has(id));
      console.log(`Candidatas: ${candidates.length} (corte ${cutoff}, ${daysAfter} días)`);

      const nowMs = Date.now();
      let sent = 0; let skipped = 0;
      for (const clientId of candidates) {
        if (sent >= RETENTION_MAX_PER_RUN) { console.log("Tope de la corrida alcanzado."); break; }
        const lastDate = lastByClient[clientId];
        if (manual.has(`${clientId}-${lastDate}`)) { skipped++; continue; }

        const guardRef = db.doc(`sentReminders/retention_${clientId}`);
        const guard = await guardRef.get();
        if (guard.exists) {
          const g = guard.data() || {};
          if (g.lastApptDate === lastDate) { skipped++; continue; }
          if (g.lastSentAtMs && nowMs - g.lastSentAtMs < RETENTION_COOLDOWN_DAYS * 86400000) { skipped++; continue; }
        }

        const [cSnap, cpSnap] = await Promise.all([
          db.doc(`clients/${clientId}`).get(),
          db.doc(`clientsPrivate/${clientId}`).get(),
        ]);
        if (!cSnap.exists) { skipped++; continue; }
        const c = cSnap.data() || {};
        const email = (cpSnap.exists && cpSnap.data().email) || c.email || "";
        if (!email) { skipped++; continue; }

        const dias = Math.round((nowMs - Date.parse(`${lastDate}T12:00:00-03:00`)) / 86400000);
        const vars = {
          nombre: c.first || "",
          apellido: c.last || "",
          nombreCompleto: `${c.first || ""} ${c.last || ""}`.trim(),
          bizName,
          dias: dias > 0 ? dias : daysAfter,
        };
        const subject = fillTemplate(tpl.subject || "", vars);
        const body = fillTemplate(tpl.body || "", vars);

        // Candado PRIMERO: preferimos perder un envío antes que duplicarlo.
        await guardRef.set({
          type: "retention",
          clientId,
          lastApptDate: lastDate,
          lastSentAtMs: nowMs,
          sentAt: FieldValue.serverTimestamp(),
          count: FieldValue.increment(1),
        }, {merge: true});

        await db.collection("mail").add({
          to: [email],
          message: {subject, html: body.replace(/\n/g, "<br>"), text: body},
          createdAt: FieldValue.serverTimestamp(),
        });
        sent++;
      }
      console.log(`Reactivación: ${sent} enviados, ${skipped} omitidos (ya avisados o sin email).`);
    },
);
