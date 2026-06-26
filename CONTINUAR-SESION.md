# Prompt de continuación — GLAMB OS

> Copiá y pegá TODO lo de abajo (dentro del bloque) como primer mensaje en la nueva sesión.

---

Hola, retomamos el trabajo en **GLAMB OS**. Sos mi desarrollador de confianza en este proyecto; venimos trabajando hace varias sesiones. Acá tenés todo el contexto para seguir como si nunca nos hubiéramos cortado.

## Cómo me gusta trabajar (importante)
- **Hablame en español, tono argentino (de "vos"), informal y claro.**
- **Verificá SIEMPRE que las cosas funcionen ANTES de decirme que están listas.** No me digas "ya está" si no lo probaste. Esto es lo más importante para mí.
- **Sé honesto con las limitaciones.** Si algo no se puede o tiene un costo/condición, decímelo de una con las opciones reales, no me vendas humo.
- Para pasos en consolas externas (Firebase, Google Cloud, Meta), **guiame paso a paso y pedime capturas de pantalla**; yo te las mando.
- Me gustan las cosas **automáticas** siempre que se pueda.
- Antes de cambios grandes o riesgosos sobre datos en vivo, explicame el plan y confirmá conmigo.

## El proyecto
- **App:** GLAMB OS — sistema de gestión para un salón de belleza (clientes, agenda/turnos, caja, finanzas, catálogo, comunicaciones, IA "Athenas").
- **Archivo principal:** `glamb-os-firebase.html` (~11.000 líneas). Es una **PWA de un solo archivo HTML**, sin build step.
- **Repo / rama de trabajo:** `danieldiazmendez92-cpu/claude-SuperAppGlamb`, rama **`claude/beautiful-fermat-l5mac7`**. Desarrollá y pusheá SIEMPRE en esa rama. NO crear PRs salvo que lo pida.
- **Deploy:** al pushear a esa rama, un GitHub Action despliega solo a Firebase (Hosting + Firestore Rules + Functions). Tarda 1-2 min.
- **Firebase:** proyecto `glamb-os`. Firestore en región **`southamerica-east1`**. Auth + Firestore (SDK compat v10.12.5 por CDN). Plan Blaze.

## Reglas de arquitectura del código (respetalas)
- Todo el JS está dentro de un IIFE `(function(){ 'use strict'; ... })()`. **Las funciones NO son globales**, así que `onclick="fn()"` inline en HTML estático NO funciona. Para HTML estático: asigná handlers por JS (`$('id').onclick = fn`) o usá `data-action` (ACTION_MAP) / `data-go`/`data-page`.
- **Persistencia (cómo se guarda cada cosa):**
  - Colecciones por-documento (`SYNCED_COLLECTIONS`): `clients`, `collaborators`, `appointments`, `payments`, `salesTickets`, `pendingCharges`.
  - `financePrivate` (solo admin): liquidaciones, deducciones, gastos, impuestos, presupuestos, categorías.
  - `clientsPrivate` (lectura solo admin): teléfono y email de clientes.
  - Blob compartido `appState/main`: todo el resto de `PERSIST_KEYS`.
  - `localStorage` del dispositivo: config de Athenas (API keys).
  - `saveState()` guarda en localStorage + nube (debounce 800ms). Hay indicador visible abajo a la izquierda: "Guardando…/Guardado ✓/Sin guardar".
- Service worker `sw.js` es **network-first**, cache actual `glamb-os-v2`. Si cambiás algo y el usuario no lo ve, suele ser caché: subí la versión del cache y decime que recargue cerrando/abriendo dos veces.
- En commits/PRs: terminá los mensajes de commit con el trailer Co-Authored-By que ya venimos usando. **Nunca** incluyas el identificador del modelo en commits ni en código.

## Qué ya está hecho y funcionando
1. **Bugs de scope corregidos** (selectores de chips, autocompletados de cliente).
2. **Footer del perfil de cliente** rediseñado para mobile (botones Volver/Eliminar visibles).
3. **Importar y Exportar CSV de clientes** (exportar es solo-admin, incluye teléfono/email; columnas compatibles para reimportar).
4. **Etiqueta automática "Alto gasto"** configurable en Catálogo (monto + período), solo admin.
5. **Fix grande de sincronización:** `clients` y `collaborators` se movieron del blob a colecciones por-documento porque con +1000 clientes el blob superaba el límite de 1 MB de Firestore y fallaba TODO el guardado en silencio. Verificado: blob queda en ~5 KB, sin datos incompatibles.
6. **Guardado robusto al cerrar/ocultar pestaña** (flush a Firestore en `visibilitychange`/`pagehide`/`beforeunload`) + indicador de guardado visible.
7. **Email funcionando:** extensión Firebase "Trigger Email from Firestore" instalada y verificada (delivery SUCCESS). Envía desde **glambbelgrano@gmail.com** (SMTP Gmail con contraseña de aplicación). La app encola en la colección `mail`.
8. **Emails de turno con calendario:** confirmación (`booking`) y recordatorio (`preEmail`) incluyen botón "📅 Agregar a mi calendario" (link a Google Calendar) + adjunto `.ics`. OJO: la sincronización 100% automática silenciosa NO es posible con esta extensión (descarta el campo `icalEvent`); quedó en "un toque".
9. **API key de Athenas** ahora se persiste en localStorage del dispositivo (antes se perdía).
10. **Recordatorios server-side:** se creó la Cloud Function `sendAppointmentReminders` (`functions/index.js`) que corre cada 15 min, busca turnos dentro de las 4h previas y manda el recordatorio por email (encola en `mail`), con deduplicación en la colección `sentReminders`. Se quitó el envío de `preEmail` del lado del navegador para no duplicar. La plantilla NO menciona a la colaboradora.

## ⚠️ LO PRIMERO QUE HAY QUE HACER (pendiente urgente)
La Cloud Function `sendAppointmentReminders` **NO terminó de desplegarse**: el deploy se frena porque falta habilitar la **API de Cloud Scheduler** y la cuenta de servicio no tiene permiso para activarla sola.
- **Como ya saqué el envío de recordatorios del navegador y la función no está activa, AHORA MISMO no salen recordatorios automáticos por email.** Hay que resolver esto cuanto antes.
- **Acción (el usuario, en Google Cloud Console del proyecto `glamb-os`):** habilitar estas APIs:
  - Cloud Scheduler API → https://console.cloud.google.com/apis/library/cloudscheduler.googleapis.com?project=glamb-os
  - Pub/Sub API (`pubsub.googleapis.com`)
  - Eventarc API (`eventarc.googleapis.com`)
  - (Cloud Run, Cloud Build, Artifact Registry y Cloud Functions ya están habilitadas.)
- Después, **re-desplegar** (volver a correr el GitHub Action de la rama, p.ej. con un push vacío o re-run). Confirmar en el log que el paso "Deploy Functions" termina OK (debe tardar **minutos**, no segundos; si tarda segundos, falló — leer el log).
- **Verificar de punta a punta:** crear un turno de prueba con email real ~3-4h en el futuro y confirmar que llega el recordatorio, o revisar la colección `sentReminders` y los logs de la función.

## Lo que sigue después (proyecto WhatsApp automático)
El usuario quiere **recordatorios de turno automáticos por WhatsApp, 4 horas antes**. Decisiones ya tomadas:
- Va por la **API oficial de WhatsApp Business de Meta** (Opción A).
- Usa un **número nuevo dedicado** solo para la API (está comprándolo). El número actual de GLAMB sigue en la app de WhatsApp Business para chat manual.
- **No** necesita editar la plantilla seguido; alcanza con dejar una buena ahora. Debe tener los datos del turno y **NO** mencionar a la colaboradora que atiende.
- **Plantilla acordada:**
  > Hola *{{nombre}}* 👋 Te recordamos tu turno en *GLAMB*:
  > 📅 {{fecha}}
  > 🕐 {{hora}}
  > 💅 {{servicio}}
  >
  > ¡Te esperamos!
- **Limitación que el usuario ya conoce y aceptó:** con la API de Meta, las plantillas las debe aprobar Meta (cada cambio se re-aprueba), y hay costo por mensaje. La "aparición automática" depende del WhatsApp del cliente.
- **Pasos pendientes:** (1) el usuario crea la app en developers.facebook.com, agrega el producto WhatsApp, conecta el número dedicado, genera token permanente y crea/aprueba la plantilla; (2) yo construyo una Cloud Function (o extiendo `sendAppointmentReminders`) que llame a la API de Meta para enviar la plantilla a los turnos dentro de las 4h. La infraestructura de funciones programadas ya quedó armada con el recordatorio de email.

## Estado de cuentas/datos útiles
- Email remitente del sistema: **glambbelgrano@gmail.com** (contraseña de aplicación ya cargada en la extensión).
- Email del dueño: danieldiazmendez92@gmail.com.
- Colección de cola de emails: `mail`. Dedup de recordatorios: `sentReminders`.

Arrancá confirmando el pendiente urgente (deploy de la función de recordatorios) y seguimos. Gracias.
