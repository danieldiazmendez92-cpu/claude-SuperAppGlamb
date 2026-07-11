# Prompt de continuación — GLAMB OS

> Copiá y pegá TODO lo de abajo (dentro del bloque) como primer mensaje en la nueva sesión/proyecto.

---

Hola, retomamos el trabajo en **GLAMB OS**. Sos mi desarrollador de confianza en este proyecto; venimos trabajando hace varias sesiones. Acá tenés todo el contexto para seguir como si nunca nos hubiéramos cortado.

## Cómo me gusta trabajar (importante)
- **Hablame en español, tono argentino (de "vos"), informal y claro.**
- **Verificá SIEMPRE que las cosas funcionen ANTES de decirme que están listas.** No me digas "ya está" si no lo probaste (levantá la app en un navegador real, seedeá datos de prueba si hace falta). Esto es lo más importante para mí.
- **Sé honesto con las limitaciones.** Si algo no se puede o tiene un costo/condición, decímelo de una con las opciones reales, no me vendas humo.
- Para pasos en consolas externas (Firebase, Google Cloud, Meta), **guiame paso a paso y pedime capturas de pantalla**; yo te las mando.
- Me gustan las cosas **automáticas** siempre que se pueda.
- Antes de cambios grandes o riesgosos sobre datos en vivo, explicame el plan y confirmá conmigo.
- **No soy programador.** Explicame las cosas en criollo, con impacto real ("esto te hace perder plata", "esto rompe X"), no en jerga técnica.

## El proyecto
- **App:** GLAMB OS — sistema de gestión completo para el salón de belleza GLAMB (agenda/turnos, caja/cobros, clientes con historial, catálogo de servicios, equipo/comisiones, RRHH/liquidaciones, finanzas + contabilidad formal, comunicaciones email/WhatsApp + encuestas, asistente de IA "Athenas").
- **La app está en producción, en uso real todos los días.** Cualquier cambio en datos (clientes, turnos, tickets, finanzas) tiene que ser reversible o muy cuidadoso. Ante la duda, preguntame antes de tocar datos de producción.
- **Archivo principal:** `glamb-os-firebase.html` (~12.500 líneas). Es una **PWA de un solo archivo HTML**, todo el JS en un único IIFE, sin build step.
- **Repo / rama de trabajo:** `danieldiazmendez92-cpu/claude-SuperAppGlamb`, rama **`claude/beautiful-fermat-l5mac7`**. Desarrollá y pusheá SIEMPRE en esa rama. NO crear PRs salvo que lo pida.
- **Deploy:** al pushear a esa rama, un GitHub Action (`.github/workflows/firebase-deploy.yml`) despliega a Firebase: Hosting + Firestore Rules + Cloud Functions. Tarda 1-2 min. El paso de Functions usa `--force` (necesario para la política de limpieza de Artifact Registry).
- **Firebase:** proyecto `glamb-os`. Firestore en región `southamerica-east1`. Auth + Firestore (SDK compat v10.12.5 por CDN). Plan Blaze.
- **Roles de usuario:** `admin` (todo), `medio`/recepción (clientes sin datos de contacto + agenda + caja, sin finanzas/RRHH), `bajo`/colaboradora (solo su agenda de hoy + sus propias ventas).
- **Cache del Service Worker:** `sw.js`, versión actual **`glamb-os-v37`**. Cada cambio en el HTML o el SW hay que subirle el número de versión (`vN` → `vN+1`) para forzar que el navegador traiga lo nuevo. Avisame que cierre y abra la app **dos veces** para verlo.

## Reglas de arquitectura del código (respetalas)
- Todo el JS está en un IIFE `(function(){ 'use strict'; ... })()`. Las funciones NO son globales: `onclick="fn()"` inline en HTML estático no funciona. Usar `data-action` (ACTION_MAP) / `data-go` / `data-page`, o asignar handlers por JS.
- **Persistencia (dónde vive cada cosa):**
  - `SYNCED_COLLECTIONS` (una colección propia por entidad, evita pisadas entre equipos): `clients`, `collaborators`, `appointments`, `payments`, `salesTickets`, `pendingCharges`, `blockers`, `cashClosings`.
  - `financePrivate/main` (solo admin lee/escribe, regla de Firestore): liquidaciones, deducciones, gastos, impuestos, presupuestos, categorías de gasto, **y ahora también `accounting`** (asiento de apertura + ajustes manuales de la contabilidad formal).
  - `clientsPrivate/{id}` (solo admin lee): teléfono y email de clientes.
  - `appState/catalog` y `appState/config` (documentos propios, anti-pisado): catálogo de servicios; comms/athenas/reviews/cashSession/etc.
  - Blob compartido `appState/main`: el resto de `PERSIST_KEYS`.
  - `localStorage` del dispositivo: config de Athenas (API keys), copia local del estado.
  - `saveState()` guarda en localStorage + nube (debounce 800ms + intervalo 5s + flush forzado al cerrar/ocultar pestaña). Indicador visible abajo a la izquierda: "Guardando…/Guardado ✓/Sin guardar".
  - **Caché offline de Firestore activado** (`enablePersistence`, IndexedDB): al reabrir la app ya no se re-descarga toda la base — el server solo manda lo que cambió. Baja costo de lecturas y acelera el arranque.
- **Turnos (`state.appointments`)**: usan `a.memberId` (colaboradora) y `a.service` (texto) directamente — **NO tienen `a.lines[]`**. Ese array es de los tickets de venta (`state.salesTickets`), no de la agenda. Confundir estos dos modelos ya causó bugs.
- **Descuentos en Caja**: tres tipos — `canje` (cobro $0, comisión sobre precio+adicionales), `employee` (colaboradora se atiende: no entra plata, se descuenta del sueldo vía RRHH, quien atendió cobra comisión igual), `client` (bonificación, comisión sobre precio final).
- **Señas y propinas (criterio contable, ya validado)**: la seña es un PASIVO al recibirse, NO ingreso — recién se reconoce como venta cuando se aplica o se retiene por inasistencia. La propina es plata de la colaboradora, no facturación del local (se excluye de "ventas").
- En commits: terminá los mensajes con el trailer `Co-Authored-By` que ya venimos usando. **Nunca** incluyas el identificador del modelo (Sonnet/Opus/etc.) en commits, código, ni nada que se suba al repo — solo en el chat.

## Qué ya está hecho y funcionando (por bloques)

### Infraestructura / costos / seguridad
1. **Recordatorios de turno por email**: Cloud Function `sendAppointmentReminders` (`functions/index.js`) corre server-side cada 15 min, ya **desplegada y funcionando** (se resolvió toda la cadena de permisos: Cloud Scheduler API, Cloud Billing API, rol IAM `roles/iam.serviceAccountUser` en la cuenta de servicio de Compute, y `--force` en el deploy para la política de limpieza de imágenes). **El usuario la tiene pausada a propósito en Comunicaciones mientras sigue probando** — avisale antes de asumir que "no funciona": hay que activar la plantilla ahí para que empiece a mandar.
2. **Backups**: (a) botón "Copia de seguridad" en Clientes (solo admin) descarga un JSON completo del estado (clientes con contacto, turnos, tickets, pagos, finanzas, catálogo, config) — a propósito sin botón de "restaurar" para evitar pisar la base por error; (b) **PITR (point-in-time recovery) de Firestore activado**, 7 días de retención, desde la consola de Firebase.
3. **Costos de Firestore optimizados**: caché offline (ver arriba) + `_blobShadow`/`_financeShadow` (no se re-escribe `appState/main` ni `financePrivate/main` si el contenido no cambió — antes se reescribían en cada acción de caja aunque el cambio real viviera en otra colección).
4. Roles y reglas de Firestore (`firestore.rules`) protegen finanzas/RRHH y contacto de clientes a nivel servidor, no solo visual. (Pendiente de decidir: endurecer más los permisos de escritura por rol — el usuario evaluó el riesgo como bajo dado el perfil técnico de sus colaboradoras y decidió no priorizarlo por ahora.)

### Módulo Inicio (rediseñado esta sesión)
5. KPIs reales por rol (antes eran fórmulas inventadas): admin ve ventas del mes vs. mes anterior (▲/▼%), turnos del mes, ticket promedio, pendiente de cobro; recepción ve turnos de hoy + caja; colaboradora ve sus turnos y sus ventas de hoy. Panel "Requiere acción" (caja sin cerrar, cobros pendientes, próximo turno). Botón grande que cambia solo entre "Abrir caja"/"Cerrar caja". Athenas (el panel oscuro de sugerencias) se dejó intacto a pedido del usuario.
6. **Fix de doble conteo contable**: "Ventas del mes" ahora es servicios (sin propinas) de tickets confirmados Y parciales, restando el saldo pendiente (que se cuenta aparte cuando se cobra, para no duplicarlo). Mismo criterio aplicado en el resumen CFO de Finanzas (`finTicketRevenue`).

### Finanzas — Contabilidad formal (nuevo, esta sesión)
7. Nueva pestaña **"Libros"** en Finanzas (solo admin, datos en `financePrivate` vía `state.accounting`):
   - **Asiento de apertura**: caja/banco/MP + equipamiento/mobiliario + deudas iniciales; el capital se calcula solo.
   - **Libro diario DERIVADO automáticamente** de la operación real (ventas por medio de pago, señas recibidas/aplicadas, propinas, saldos pendientes como deudores, retiros de socio, gastos de Caja+Finanzas, liquidaciones pagadas) — nadie carga asientos a mano para la operación diaria. Export a CSV por mes.
   - **Balance general** a cualquier fecha (Activo = Pasivo + Patrimonio, con verificación visible de que cierra) y **Estado de resultados** mensual.
   - **Libro mayor** por cuenta con saldo corrido.
   - **Asientos manuales de ajuste**, con validación de que Debe = Haber.
   - **Garantía de partida doble**: toda la lógica fue auditada con un dataset adversarial (23 asientos, casos borde de propinas impagas, tickets viejos sin desglose, etc.). Si algún dato de origen viene incompleto, existe una cuenta puente **"Diferencias de registro"** que absorbe la diferencia y la deja visible en vez de romper el balance en silencio.

### Otros fixes de esta sesión
8. **Caja**: el primer turno de la lista (preseleccionado automáticamente) a veces cargaba un servicio genérico del catálogo en vez de lo agendado — pasaba cuando la agenda llegaba de la nube después de armar el formulario. Corregido con seguimiento de `_saleLinesApptId`; verificado que además no pisa una edición en curso del mismo turno.
9. Circuito de "colaboradora como clienta" explicado y confirmado que funciona bien tal cual está (descuento tipo `employee` en Caja: no entra plata, se descuenta del sueldo, la persona que atendió cobra comisión igual). El usuario decidió NO tocarlo.
10. Bug de "Sin profesional" en un registro de Caja: identificado que pasa cuando se cobra sin elegir la colaboradora en la línea (el sistema avisa "Falta colaboradora" pero no bloquea el guardado). **El usuario decidió dejarlo como está por ahora** — quedó pendiente por si en el futuro quiere que sea obligatorio.

### De sesiones anteriores (ya eran estables)
11. Import/Export CSV de clientes, etiqueta "Alto gasto" configurable, fix de sincronización clients/collaborators a colecciones propias (blob superaba 1MB con +1000 clientes), guardado robusto al cerrar pestaña, emails con adjunto .ics y botón "agregar a calendario", reseñas de encuesta vinculadas al turno real (`appt.memberId`, no `appt.lines`), filtro de reseñas por colaboradora en Comunicaciones.

## Deuda pendiente / próximos pasos posibles
- **WhatsApp Business API**: recordatorios automáticos 4hs antes por API oficial de Meta. Decisiones ya tomadas (número dedicado, plantilla acordada sin mencionar colaboradora, usuario acepta costo por mensaje y aprobación de Meta). Pasos pendientes del lado del usuario: crear la app en developers.facebook.com, conectar número, generar token, aprobar plantilla. Del lado nuestro: construir la function que llame a la API de Meta (la infraestructura de function programada ya existe, reutilizable).
- **Reseñas históricas sin colaboradora vinculada**: respuestas de encuesta anteriores al fix de `appt.memberId` (commit `f13ebf6`) quedaron con `collaboratorId: null`. Se podría investigar inferirlas cruzando fecha+cliente contra la agenda, si hace falta recuperarlas.
- **Permisos de escritura por rol más estrictos** a nivel Firestore rules (hoy cualquier usuaria logueada podría en teoría escribir en colecciones que no le corresponden visualmente). Evaluado como riesgo bajo, no priorizado.
- **"Sin profesional" en Caja**: evaluar si conviene hacer obligatorio elegir colaboradora antes de guardar un cobro (evitaría ventas sin comisión asignada). El usuario no lo pidió todavía.
- Dos manuales de usuario en `docs/manual-colaboradora.html` y `docs/manual-recepcion.html` (imprimibles a PDF desde Chrome) — podrían necesitar actualización si cambia mucho la UI de Inicio/Finanzas.

## Estado de cuentas/datos útiles
- Email remitente del sistema: **glambbelgrano@gmail.com** (contraseña de aplicación cargada en la extensión "Trigger Email from Firestore").
- Email del dueño: danieldiazmendez92@gmail.com.
- Colección de cola de emails: `mail`. Dedup de recordatorios: `sentReminders`.
- Firestore: PITR activo (7 días). Cloud Scheduler, Cloud Billing, Pub/Sub, Eventarc, Cloud Run APIs todas habilitadas.

Arrancá preguntándome en qué querés trabajar hoy — no hay ningún pendiente urgente/bloqueante en este momento, todo lo crítico quedó resuelto en la sesión anterior.
