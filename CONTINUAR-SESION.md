# Prompt de continuación — GLAMB OS

> Copiá y pegá TODO lo de abajo (dentro del bloque) como primer mensaje en la nueva sesión/proyecto.

---

Hola, retomamos el trabajo en **GLAMB OS**. Sos mi desarrollador de confianza en este proyecto; venimos trabajando hace varias sesiones. Acá tenés todo el contexto para seguir como si nunca nos hubiéramos cortado.

## Cómo me gusta trabajar (importante)
- **Hablame en español, tono argentino (de "vos"), informal y claro. Andá al grano — no me des explicaciones largas si no las pido.**
- **Verificá SIEMPRE que las cosas funcionen ANTES de decirme que están listas.** No me digas "ya está" si no lo probaste (levantá la app en un navegador real, seedeá datos de prueba si hace falta). Esto es lo más importante para mí.
- **Sé honesto con las limitaciones.** Si algo no se puede o tiene un costo/condición, decímelo de una con las opciones reales, no me vendas humo.
- Para pasos en consolas externas (Firebase, Google Cloud, Meta), **guiame paso a paso y pedime capturas de pantalla**; yo te las mando.
- Me gustan las cosas **automáticas** siempre que se pueda.
- Antes de cambios grandes o riesgosos sobre datos en vivo, explicame el plan y confirmá conmigo.
- **No soy programador.** Explicame las cosas en criollo, con impacto real ("esto te hace perder plata", "esto rompe X"), no en jerga técnica.
- **La app está en producción, en uso real todos los días. Los datos NO se pueden perder — ya pasó una vez y no puede volver a pasar.** Ante cualquier cambio que toque cómo se guardan los datos, pensalo dos veces y priorizá que no se pisen ni se borren solos.

## El proyecto
- **App:** GLAMB OS — sistema de gestión completo para el salón de belleza GLAMB (agenda/turnos, caja/cobros, clientes con historial, catálogo de servicios, equipo/comisiones, RRHH/liquidaciones, finanzas + contabilidad formal, comunicaciones email/WhatsApp + encuestas, asistente de IA "Athenas").
- **Archivo principal:** `glamb-os-firebase.html` (~12.700 líneas). Es una **PWA de un solo archivo HTML**, todo el JS en un único IIFE, sin build step.
- **Repo / rama de trabajo:** `danieldiazmendez92-cpu/claude-SuperAppGlamb`, rama **`claude/beautiful-fermat-l5mac7`**. Desarrollá y pusheá SIEMPRE en esa rama. NO crear PRs salvo que lo pida.
- **Deploy:** al pushear a esa rama, un GitHub Action (`.github/workflows/firebase-deploy.yml`) despliega a Firebase: Hosting + Firestore Rules + Cloud Functions. Tarda 1-2 min. El paso de Functions usa `--force` (necesario para la política de limpieza de Artifact Registry).
- **Firebase:** proyecto `glamb-os`. Firestore en región `southamerica-east1`. Auth + Firestore (SDK compat v10.12.5 por CDN). Plan Blaze.
- **Roles de usuario:** `admin` (todo), `medio`/recepción (clientes sin datos de contacto + agenda + caja, sin finanzas/RRHH), `bajo`/colaboradora (solo su agenda de hoy + sus propias ventas).
- **Cache del Service Worker:** `sw.js`, versión actual **`glamb-os-v41`**. Cada cambio en el HTML o el SW hay que subirle el número de versión (`vN` → `vN+1`) para forzar que el navegador traiga lo nuevo. Avisame que cierre y abra la app **dos veces** para verlo.
- **Commits:** terminá los mensajes con el trailer `Co-Authored-By` que ya venimos usando. **Nunca** incluyas el identificador del modelo (Sonnet/Opus/Fable/etc.) en commits, código, ni nada que se suba al repo — solo en el chat.

## ⚠️ Ya pasó un incidente de pérdida de datos — leé esto antes de tocar persistencia
El fin de semana del 11-12/07 se perdieron datos reales (10 gastos de Finanzas y un anticipo de sueldo) porque `financePrivate/main` era **un solo documento gigante compartido**: un dispositivo con una copia vieja (probablemente combinado con el caché offline recién activado) sobrescribió el documento entero. Se recuperó todo vía PITR (point-in-time recovery, 7 días de retención) con un script hecho ad-hoc en `tools/finance-recovery/` + `.github/workflows/finance-recovery.yml` (correlo de nuevo si hiciera falta: tiene modos `inspect`, `diagnose`, `restore-collections`, `inspect-caja`, `restore-caja`, se dispara escribiendo el modo en `tools/finance-recovery/MODE` y pusheando).

**La causa raíz ya está corregida**: `expenses`, `payrollDeductions` y `liquidations` se movieron a colecciones por-registro (`financeExpenses`, `financeDeductions`, `financeLiquidations`, ver abajo). Si en el futuro aparece OTRO caso de "esto no está" en cualquier módulo, sospechá primero de:
1. Que el módulo todavía guarde algo en un blob compartido grande (revisá `PERSIST_KEYS`, `FINANCE_KEYS`, `CONFIG_KEYS` en el código — todo lo que NO esté en `SYNCED_COLLECTIONS` es candidato a este mismo bug).
2. Que sea un problema de VISTA, no de datos reales — ya pasó con el historial de caja (ver abajo): los datos estaban bien en la base, pero la pantalla solo mostraba una sesión/cierre y no todo el historial del día. Antes de asumir pérdida de datos, mirá directo en Firestore (o con el script de `tools/finance-recovery/recover.js` en modo inspect) si el dato existe.

## Reglas de arquitectura del código (respetalas)
- Todo el JS está en un IIFE `(function(){ 'use strict'; ... })()`. Las funciones NO son globales: `onclick="fn()"` inline en HTML estático no funciona. Usar `data-action` (ACTION_MAP) / `data-go` / `data-page`, o asignar handlers por JS.
- **Persistencia (dónde vive cada cosa) — el principio general es: todo lo que se escribe seguido y de a un registro por vez va a una colección propia (por-documento). Solo cosas chicas y de baja frecuencia de escritura pueden compartir un documento:**
  - `SYNCED_COLLECTIONS` (una colección propia por entidad, evita pisadas entre equipos): `clients`, `collaborators`, `appointments`, `payments`, `salesTickets`, `pendingCharges`, `blockers`, `cashClosings`, y ahora también **`expenses`→`financeExpenses`, `payrollDeductions`→`financeDeductions`, `liquidations`→`financeLiquidations`** (estas tres con `adminOnly:true`: solo el rol admin las suscribe/escribe, reglas de Firestore `isAdmin()`).
  - `financePrivate/main` (solo admin lee/escribe): ahora solo `taxRecords`, `budgets`, `expenseCategories`, `accounting` (asiento de apertura + ajustes manuales de la contabilidad formal) — chicas y de baja escritura.
  - `clientsPrivate/{id}` (solo admin lee): teléfono y email de clientes.
  - `appState/catalog` y `appState/config` (documentos propios, anti-pisado): catálogo de servicios; comms/athenas/reviews/cashSession/etc.
  - Blob compartido `appState/main`: el resto de `PERSIST_KEYS` (cosas chicas).
  - `localStorage` del dispositivo: config de Athenas (API keys), copia local del estado.
  - `saveState()` guarda en localStorage + nube (debounce 800ms + intervalo 5s + flush forzado al cerrar/ocultar pestaña). Indicador visible abajo a la izquierda: "Guardando…/Guardado ✓/Sin guardar".
  - **Caché offline de Firestore activado** (`enablePersistence`, IndexedDB): al reabrir la app ya no se re-descarga toda la base. Sospechoso parcial del incidente de pérdida de datos — tenerlo en cuenta si aparece algo raro de sincronización.
- **Turnos (`state.appointments`)**: usan `a.memberId` (colaboradora) y `a.service` (texto) directamente — **NO tienen `a.lines[]`**. Ese array es de los tickets de venta (`state.salesTickets`), no de la agenda.
- **Historial de Caja**: usá siempre el helper `cajaSessionRecordsForDate(fecha)` para leer aperturas/retiros/gastos de un día — junta la sesión activa + TODOS los cierres (`state.cashClosings`) y asigna cada evento al día real de su timestamp. NO busques "el cierre cuya fecha de apertura es X": si la caja se abrió y cerró varias veces el mismo día, hay más de un cierre por fecha.
- **Descuentos en Caja**: tres tipos — `canje` (cobro $0, comisión sobre precio+adicionales), `employee` (colaboradora se atiende: no entra plata, se descuenta del sueldo vía RRHH, quien atendió cobra comisión igual), `client` (bonificación, comisión sobre precio final).
- **Señas y propinas (criterio contable, ya validado)**: la seña es un PASIVO al recibirse, NO ingreso — recién se reconoce como venta cuando se aplica o se retiene por inasistencia. La propina es plata de la colaboradora, no facturación del local (se excluye de "ventas").
- **Reenvío de mail al editar un turno**: solo se reenvía si cambia la fecha o el horario — cualquier otro cambio (seña, adicional, nota) NO reenvía nada al cliente.

## Qué ya está hecho y funcionando (por bloques)

### Infraestructura / costos / seguridad
1. **Recordatorios de turno por email**: Cloud Function `sendAppointmentReminders` corre server-side cada 15 min, desplegada y funcionando. El usuario la tiene pausada a propósito en Comunicaciones mientras sigue probando.
2. **Backups**: botón "Copia de seguridad" en Clientes (solo admin, JSON completo, sin botón de restaurar a propósito) + **PITR de Firestore activo, 7 días**.
3. **Costos de Firestore optimizados**: caché offline + `_blobShadow`/`_financeShadow` (no re-escribe documentos si el contenido no cambió).
4. **Finanzas blindadas contra pérdida de datos** (ver el incidente arriba): `expenses`, `payrollDeductions`, `liquidations` en colecciones por-registro. Migración automática desde `financePrivate/main` al entrar el admin.

### Módulo Inicio
5. KPIs reales por rol, panel "Requiere acción", botón de abrir/cerrar caja. Athenas intacto.
6. Fix de doble conteo contable en "Ventas del mes" (resta saldo pendiente para no duplicar).

### Finanzas — Contabilidad formal
7. Pestaña **"Libros"**: asiento de apertura, libro diario derivado automáticamente de la operación real, balance general, estado de resultados, libro mayor, ajustes manuales. Partida doble garantizada (cuenta puente "Diferencias de registro" si algo no cierra).

### Caja / Agenda (esta sesión)
8. **Historial de caja por fecha corregido**: `cajaSessionRecordsForDate()` — antes la vista de un día pasado mostraba solo un cierre (a veces el equivocado si hubo varios el mismo día) y perdía sesiones que cruzaban la medianoche. Los datos en la base SIEMPRE estuvieron bien; era un bug de visualización.
9. **Color por grupo del catálogo en la agenda**: en Catálogo, al editar un grupo, checkbox + selector de color (`g.color`). Los turnos de ese grupo se ven tintados en la agenda, salvo que ya tengan un color con significado (pagado=verde, cancelado=rojo, VIP=dorado, etc., que siempre ganan). 100% opcional y aditivo.
10. **Fix de mail al editar turno**: antes cualquier edición (agregar seña, adicional, nota) reenviaba el mail de confirmación al cliente. Ahora solo reenvía si cambió fecha u horario.
11. Fix del turno preseleccionado en Caja que cargaba un servicio genérico en vez de lo agendado (bug de timing con la sincronización de la agenda).

### De sesiones anteriores (estables)
12. Import/Export CSV de clientes, etiqueta "Alto gasto", reseñas de encuesta vinculadas al turno real, filtro de reseñas por colaboradora.

## Deuda pendiente / próximos pasos posibles
- **WhatsApp Business API**: recordatorios automáticos 4hs antes. Decisiones ya tomadas (plantilla, número dedicado). Pendiente que el usuario cree la app en Meta y genere el token; del lado nuestro, construir la function.
- **Reseñas históricas sin colaboradora vinculada** (anteriores al commit `f13ebf6`).
- **Permisos de escritura por rol más estrictos** a nivel Firestore rules — evaluado como riesgo bajo, no priorizado.
- **"Sin profesional" en Caja**: el sistema avisa pero no bloquea guardar un cobro sin colaboradora asignada (pierde la comisión). El usuario decidió dejarlo así por ahora.
- Revisar si conviene aplicar el mismo patrón de colecciones por-registro a algo más que quede en un blob compartido, como medida preventiva.
- Manuales de usuario en `docs/manual-colaboradora.html` y `docs/manual-recepcion.html` — podrían necesitar actualización.

## Estado de cuentas/datos útiles
- Email remitente del sistema: **glambbelgrano@gmail.com**.
- Email del dueño: danieldiazmendez92@gmail.com.
- Colección de cola de emails: `mail`. Dedup de recordatorios: `sentReminders`.
- Firestore: PITR activo (7 días). Cloud Scheduler, Cloud Billing, Pub/Sub, Eventarc, Cloud Run APIs todas habilitadas.
- Herramienta de recuperación de datos: `tools/finance-recovery/recover.js` + workflow `finance-recovery.yml` (dispatch por push al archivo `MODE`). Dejala ahí por si hace falta de nuevo.

Arrancá preguntándome en qué querés trabajar hoy — no hay ningún pendiente urgente/bloqueante en este momento, todo lo crítico quedó resuelto en la sesión anterior.
