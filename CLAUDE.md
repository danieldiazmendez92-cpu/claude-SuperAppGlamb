# GLAMB OS — Guía de desarrollo

## Proyecto

**GLAMB OS** es un sistema de gestión operativa para un salón de belleza (GLAMB, ubicado en Belgrano, Buenos Aires). Es una **PWA de un solo archivo HTML** (`glamb-os-firebase.html`, ~11.500 líneas), sin build step, vanilla JS dentro de un IIFE. Backend: Firebase (Auth + Firestore + Hosting + Functions).

**Dueño:** Daniel Díaz Méndez (danieldiazmendez92@gmail.com). Habla español argentino ("vos"). Tono informal.

## Reglas del dueño (respetar siempre)

1. **Hablale en español argentino** (de "vos"), informal y claro.
2. **Verificá que las cosas funcionen ANTES de decir que están listas.** No decir "ya está" sin probar. Esto es lo más importante.
3. **Sé honesto con las limitaciones.** Si algo no se puede, decirlo con opciones reales.
4. Antes de cambios grandes o riesgosos sobre datos en vivo, explicar el plan y confirmar.
5. Para pasos en consolas externas (Firebase, Google Cloud, Meta), guiarlo paso a paso y pedir capturas.
6. **Desarrollar y pushear SIEMPRE en la rama indicada.** NO crear PRs salvo que lo pida.
7. Al hacer un commit, terminar el mensaje con el trailer `Co-Authored-By`. **Nunca** incluir identificador del modelo en commits ni en código.

## Estructura de archivos

```
glamb-os-firebase.html    # App principal (~11.500 líneas, TODO en un archivo)
sw.js                     # Service worker (network-first, cache versionado)
manifest.json             # PWA manifest
icon-*.png                # Íconos PWA (180, 192, 512)
survey.html               # Página pública de encuesta de satisfacción
firebase.json             # Config Firebase: hosting, firestore rules, functions
firestore.rules           # Reglas de seguridad Firestore
.firebaserc               # Proyecto Firebase: glamb-os
functions/
  index.js                # Cloud Function: recordatorios automáticos por email
  package.json            # Deps de functions (firebase-functions, firebase-admin)
.github/workflows/
  firebase-deploy.yml     # CI/CD: deploy a Firebase al pushear
glamb-os-working-v6.html  # Versión vieja de referencia (no se despliega)
CONTINUAR-SESION.md       # Handoff de sesiones anteriores (desactualizado)
MIGRATION.md              # Notas de migración de datos
```

## Deploy

- **CI/CD:** GitHub Actions (`firebase-deploy.yml`). Al pushear a la rama configurada (actualmente `claude/beautiful-fermat-l5mac7`), despliega:
  1. Firebase Hosting (el HTML + sw.js + manifest + íconos)
  2. Firestore Rules (`firestore.rules`)
  3. Cloud Functions (`functions/`)
- **Tiempo de deploy:** ~1-2 min para hosting, más para functions.
- **Proyecto Firebase:** `glamb-os`. Región Firestore: `southamerica-east1`.
- **Secret necesario:** `FIREBASE_SERVICE_ACCOUNT_GLAMB_OS` (JSON de service account).
- **IMPORTANTE:** Si se cambia la rama de trabajo, hay que actualizar `firebase-deploy.yml` línea 6 (`branches:`).

## Service Worker (`sw.js`)

- Strategy: **network-first** con fallback a cache.
- Solo intercepta requests al mismo origen (no Firebase, no CDNs).
- Cache versionado: `glamb-os-vNN`. **Bumpearlo en cada deploy** para que los usuarios reciban la actualización.
- Si el usuario no ve cambios: subir la versión del cache y decirle que cierre y reabra la app dos veces.
- Cache actual: `glamb-os-v11` (rama `claude/new-session-etlvt2`).

## Arquitectura del código (`glamb-os-firebase.html`)

### Estructura general

```
Líneas 1-18:       <head> (fonts, meta viewport, PWA tags)
Líneas 19-3350:    <style> (todo el CSS inline)
Líneas 3351-3360:  Firebase SDKs (compat v10.12.5 por CDN)
Líneas 3361-4600:  <body> HTML (toda la UI, drawers, modales, formularios)
Líneas 4601-11528: <script> (IIFE con toda la lógica JS)
```

### IIFE y ACTION_MAP

Todo el JS está dentro de `(function(){ 'use strict'; ... })()`. **Las funciones NO son globales.** No se puede usar `onclick="fn()"` en HTML estático.

**Para agregar interactividad:**
- Usar `data-action="nombreFuncion"` en el HTML y registrar en `ACTION_MAP` (~línea 11400).
- O asignar handlers por JS: `$('id').onclick = fn`.

El `ACTION_MAP` es un objeto que mapea `data-action` → función. El event delegator (línea ~11496) busca el `data-action` más cercano al click y ejecuta la función correspondiente.

### Helpers clave

```js
const $ = id => document.getElementById(id);     // Shorthand DOM
const esc = s => ...;                              // Escape HTML
const fullName = x => `${x.first||''} ${x.last||''}`.trim();
const dateKey = d => 'YYYY-MM-DD';                // Formato de fecha
const uid = p => p + timestamp + random;           // Generador de IDs
const money = n => '$' + Number(n).toLocaleString('es-AR');
```

### Estado (`state`)

Objeto global mutable con toda la data de la app. Campos principales:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `clients` | Array | Clientes del salón |
| `collaborators` | Array | Profesionales/colaboradoras |
| `appointments` | Array | Turnos (citas) |
| `payments` | Array | Pagos registrados |
| `salesTickets` | Array | Tickets de venta |
| `pendingCharges` | Array | Cobros pendientes (precargas) |
| `blockers` | Array | Bloqueos de agenda |
| `cashClosings` | Array | Cierres de caja |
| `cashSession` | Object | Sesión de caja actual (isOpen, openingAmount, etc.) |
| `catalog` | Object | Catálogo (groups → services → variants + additionals + products) |
| `liquidations` | Array | Liquidaciones de sueldo |
| `expenses` | Array | Gastos registrados |
| `users` | Array | Usuarios del sistema (demo, reemplazados por Firebase Auth) |
| `systemUsers` | Array | Usuarios reales de Firebase Auth |
| `authUser` | Object | Usuario logueado actual |
| `comms` | Object | Config de comunicaciones/plantillas |
| `reviews` | Array | Reseñas manuales |
| `surveyResponses` | Array | Respuestas de encuestas |
| `agenda` | Object | Estado de la vista de agenda (currentDate, scale, filters, etc.) |

### Persistencia (3 capas)

1. **localStorage** (`glamb-os-state-v1`): cache local para arranque offline.
2. **Firestore blob** (`appState/main`): estado compartido (todo lo que no es colección).
3. **Colecciones Firestore** (un doc por registro): datos "calientes" con concurrencia.

#### `SYNCED_COLLECTIONS` (línea ~4779)

Entidades que viven como documentos individuales en Firestore (no en el blob):

```
clients, collaborators, appointments, payments,
salesTickets, pendingCharges, blockers, cashClosings
```

Cada una tiene `onSnapshot` bidireccional. Dos usuarios editando registros distintos no se pisan.

#### `FINANCE_KEYS` (línea ~4808)

Solo admin puede leer/escribir (viven en `financePrivate/main`):
```
liquidations, payrollDeductions, expenses, taxRecords, budgets, expenseCategories
```

#### `CONFIG_KEYS` (línea ~4816)

Config compartida en `appState/config` (anti-pisado entre dispositivos):
```
cashSession, comms, reviews, surveySettings, sentSurveys,
highSpenderConfig, withdrawalReasons, expenseCategories, ownerName
```

#### `clientsPrivate` (línea ~4920)

Teléfono y email de clientes. Solo admin puede LEER. Cualquier usuario con acceso puede ESCRIBIR.

#### `appState/catalog`

Catálogo en documento propio para evitar pisado entre dispositivos.

### `saveState()` (línea ~4881)

Guarda en localStorage + dispara escritura a Firestore con debounce de 800ms. Indicador visual: "Guardando…/Guardado ✓/Sin guardar".

### Sincronización Firestore

- `subscribeCollectionsSync()`: suscribe `onSnapshot` para cada colección.
  - Primer snapshot: reemplaza completo (descarta demo/cache).
  - Siguientes: aplica solo `docChanges()` (no pisa ediciones locales pendientes).
- `syncCollections()`: empuja a Firestore solo los registros que cambiaron (diff contra shadow).
- `_applyingRemote`: flag para evitar loops de escritura durante recepción de datos remotos.

## Roles y permisos

3 niveles de usuario, configurados en Firebase Auth + colección `users`:

| Rol | Código | Acceso |
|-----|--------|--------|
| Colaboradora | `bajo` | Caja (solo sus ventas), Agenda (solo hoy) |
| Recepción | `medio` | Caja completa, Agenda, Clientes, Catálogo, Equipo |
| Admin | `admin` | Todo (Finanzas, RRHH, config, datos de contacto) |

### `state.cashMode`

Derivado del rol: `'admin'` (medio/admin) vs `'collaborator'` (bajo). Afecta qué ve y puede hacer en Caja.

### Restricciones por rol

- **Colaboradora (`bajo`):** solo puede ver/anular SUS tickets del día. No puede abrir/cerrar caja, retirar efectivo, ver KPIs del salón.
- **Recepción (`medio`):** abre/cierra caja, controla efectivo, retira para propinas/gastos. No ve Finanzas ni RRHH.
- **Admin:** todo. Análisis, control, edición, datos de contacto de clientes.

## Módulos principales

### Inicio / Comando (línea ~5514)

Dashboard con widget de Athenas IA. Muestra alertas: clientes en riesgo, huecos de agenda, cobros pendientes.

### Clientes (línea ~5661)

CRUD de clientes. Import/export CSV (solo admin). Tags automáticos (VIP, Alto gasto). Insights comerciales por cliente (frecuencia, gasto, servicios preferidos). Perfil con historial de visitas.

### Agenda (línea ~7460)

Vista de turnos por día (columnas por profesional) o semana. Drag & drop para mover turnos. Resize para ajustar duración. Bloqueos de horario. Mini-calendario (date picker).

**Turnos combinados:** múltiples appointments con el mismo `bookingId` = un turno combinado (ej: manos + pies con distintas profesionales). Se cobran juntos.

**Estados de turno:** `confirmed`, `in_progress`, `completed`, `cancelled`/`cancelado`, `no_show`, `voided`.

**Funciones clave:**
- `activeAppointments()` (línea ~5499): filtra cancelados/voided/huérfanos.
- `visibleAppointments()` (línea ~7483): NO filtra por status (muestra cancelados con styling especial).
- `reservationKey(appt)`: usa `bookingId || id` para agrupar turnos combinados.
- `reservationCharged(key)`: verifica si ya existe ticket para esa reserva.
- `openPopover(e, id)` (línea ~7856): popover de detalle del turno.
  - Footer es status-aware: muestra "Reactivar turno" si cancelado/no_show, "Cobrar visita" si activo.
  - Chips de estado permiten cambiar status (sin confirmación — posible fuente de cancelaciones accidentales).
- `reactivateAppointment(id)` (línea ~7799): reactiva turno cancelado (todos los del booking combinado).
- `cancelAppointment(id)` (línea ~7790): cancela todos los del booking combinado.

### Caja (línea ~6501)

Módulo de ventas y control de efectivo.

**Tabs:** register (venta), daily (movimientos), tickets, pending (cobros pendientes), ledger (arqueo).

**Flujo de venta:**
1. Seleccionar fuente: turno de agenda / cliente existente / cliente nuevo.
2. Si es turno: auto-carga servicios, precios, seña, colaboradoras.
3. Si hay cobros pendientes (precargas de otra colaboradora), se inyectan automáticamente.
4. Agregar líneas de servicio, definir método de pago, confirmar.
5. Se crea un `salesTicket` + `payments`.

**Funciones clave:**
- `renderCash()` (línea ~6501): render principal, sincroniza panels con `state.saleSource`.
- `fillSaleSourceOptions()` (línea ~6799): dropdown de turnos pendientes de cobro HOY.
- `selectSaleAppointment(id)` (línea ~6840): auto-inyecta pending charges al seleccionar turno.
- `renderCashKpis()` (línea ~6514): KPIs filtrados por hoy.
- `renderCashDaily()` (línea ~7136): movimientos del día seleccionado.
- `renderTickets()` (línea ~7189): tickets del día seleccionado.
- `voidTicket()` (línea ~7199): anular ticket (colaboradoras solo pueden anular los suyos del día).
- `cashClose()` / `confirmCashClose()` (línea ~7411): cierre de caja.
- `correctCashOpening()`: admin puede corregir monto de apertura.
- `renderCashPendingBanner()`: banner amarillo de cobros pendientes.
- `confirmWithdrawal()` (línea ~6628): retiros de efectivo. Si razón es "Propina", crea `tip_in` payment + withdrawal.

**Tipo de pago `tip_in`:** entrada de propina por transferencia. No cuenta como ingreso del salón. Se compensa con retiro de efectivo.

**Cobros pendientes (`pendingCharges`):** una colaboradora precarga su servicio como pendiente; la siguiente lo completa y cobra todo junto. Banner amarillo avisa cuántos hay.

### Catálogo (línea ~5951)

Estructura: `groups` → `services` → `variants` (con precio y duración). También: `additionals` (add-ons) y `products` (venta de productos).

Vista grid/lista. Filtro por grupo. CRUD completo. Config de "Alto gasto" (tag automático por monto + período).

### Equipo (línea ~5749)

Gestión de colaboradoras (CRUD) y usuarios del sistema (Firebase Auth). Config de disponibilidad horaria.

### RRHH (línea ~8928, solo admin)

Configuración de nómina por colaboradora (salario base, comisiones por grupo de servicio con overrides). Descuentos. Liquidaciones de sueldo con cálculo automático.

### Finanzas (línea ~9318, solo admin)

3 sub-tabs:
- **CFO:** dashboard con ingresos, gastos, margen, ticket promedio, desglose por grupo y colaboradora.
- **Contador:** monotributo check, gastos, impuestos, categorías de gasto.
- **Analista:** punto de equilibrio, presupuestos, comparativas.

### Comunicaciones (línea ~9871)

- **Plantillas:** confirmación de turno, recordatorio email/WA, reactivación.
- **Recordatorios automáticos:** Cloud Function server-side cada 15 min (email).
- **WA:** link directo (no API aún — pendiente integración con API oficial de Meta).
- **Encuestas:** survey.html (página pública), envío por email/WA, panel de respuestas.
- **Reseñas:** módulo manual + post-checkout automático.

### Athenas IA (línea ~10561)

Chat con IA (Google Gemini o Groq). Contexto adaptativo con datos del negocio. Caché en memoria. Historial de sesión (no persiste).

## Firestore Rules

- `users/{uid}`: auth users. Auto-registro como `pending`, admin los habilita.
- `appState/{doc}`: cualquier usuario habilitado lee/escribe.
- `clientsPrivate/{id}`: solo admin lee; cualquiera con acceso escribe.
- Colecciones sincronizadas: cualquier usuario habilitado lee/escribe.
- `financePrivate/{doc}`: solo admin.
- `mail/{id}`: cualquiera con acceso puede crear (encolar emails).
- `surveyResponses/{id}`: cualquiera puede crear (sin auth); solo admin lee.

## Cloud Function (`functions/index.js`)

`sendAppointmentReminders`: corre cada 15 min (Cloud Scheduler). Busca turnos dentro de las próximas 4 horas, envía recordatorio por email (encola en `mail`). Deduplicación en `sentReminders`.

**Estado del deploy:** puede requerir que estén habilitadas las APIs de Cloud Scheduler, Pub/Sub, Eventarc en Google Cloud Console.

## Bugs conocidos / deuda técnica

1. **Cancelación accidental de turnos:** los chips de estado en el popover ("Canc.", "No show") no piden confirmación. `updateApptStatus()` cambia el status instantáneamente. Es fácil tocar "Canc." sin querer en mobile. **Propuesta:** agregar `showConfirm` para los status destructivos.

2. **Inconsistencia de status:** `cancelAppointment()` usa `'cancelado'` (español), `updateApptStatus()` con el chip usa `'cancelled'` (inglés). El filtro `activeAppointments()` chequea ambos. **Propuesta:** unificar a un solo valor.

3. **`updateApptStatus()` no propaga a booking combinado:** si un turno combinado tiene 2 appointments con el mismo `bookingId`, cambiar el status con el chip solo afecta uno. `cancelAppointment()` y `reactivateAppointment()` sí propagan a todo el booking.

4. **Deploy branch desincronizada:** `firebase-deploy.yml` apunta a `claude/beautiful-fermat-l5mac7` pero la rama de trabajo actual es `claude/new-session-etlvt2`. Hay que actualizar el workflow si se quiere deploy automático desde la nueva rama.

5. **Dos ramas divergentes:** `claude/beautiful-fermat-l5mac7` tiene commits de mejoras de Caja (auditoría de 6 mejoras, filtros por día, dropdowns, KPIs) que NO están en `claude/new-session-etlvt2`. Si se necesitan esas mejoras, hay que hacer cherry-pick o merge.

## Commits de la rama `claude/new-session-etlvt2` (actual)

```
9f5fcc3 feat: botón Reactivar turno + popover inteligente por estado
17fb56c fix(ios): bloquear pull-to-refresh en Safari con touchmove JS
1d14254 feat(agenda): color por estado, inasistencia con seña a ingreso, bloqueos legibles y fix de horario al tocar
7400977 fix(ios): evitar zoom automático en campos y recarga accidental en iPhone
737680b fix(caja): traer seña y colaboradora del turno al cobrar
0531f92 fix(ui): ocultar turnos de clientes borrados y apilar cobro en celular
c50522b fix(sync): blindar bloqueos, cierres de caja y config contra pisado entre equipos
764a383 fix(sync): mover el catálogo a documento propio para evitar que se pise
52fc20f fix(athenas): contexto adaptativo para no superar el límite de tokens de Groq
```

## Commits exclusivos de `claude/beautiful-fermat-l5mac7` (NO en la rama actual)

```
a3969b6 feat: 6 mejoras de Caja basadas en auditoría de operación real
2dd3691 fix: Caja KPIs, tickets y movimientos filtran solo por el día de hoy
d5629f4 fix: Caja appointment dropdown shows only today's turns, panel always visible
3a58cf9 fix: refresh collaborator dropdowns in Caja when data loads after form render
324698d fix(caja): precio del catálogo no se cargaba al cambiar servicio en cobro
49204ed chore(ui): renombrar "Cerebro operativo" a "Inicio"
0155789 feat(caja): bloquear cobros en efectivo si la caja no está abierta
44c57c4 fix(ios): layout fijo — body nunca scrollea, pull-to-refresh imposible
7fbbc79 fix(ios): deshabilitar zoom manual y mejorar guard pull-to-refresh
```

**ACCIÓN PENDIENTE:** decidir si mergear estos commits a `claude/new-session-etlvt2` o descartarlos. Las mejoras de Caja son significativas.

## Pendientes conocidos

1. **Cloud Function de recordatorios:** verificar que esté deployada y funcionando (APIs de Cloud Scheduler/Pub/Sub/Eventarc habilitadas).
2. **WhatsApp API (Meta):** pendiente que el dueño cree la app en developers.facebook.com, conecte número dedicado, apruebe plantilla. Luego construir la Cloud Function que envíe por WA.
3. **Mergear ramas:** las mejoras de Caja de `beautiful-fermat` deberían incorporarse.
4. **Confirmación en chips de estado destructivos:** evitar cancelaciones accidentales de turnos.
5. **Actualizar `firebase-deploy.yml`** para que apunte a la rama de trabajo actual.

## Referencia rápida de líneas clave

| Qué | Línea aprox. |
|-----|-------------|
| CSS | 19-3350 |
| HTML body | 3361-4600 |
| Firebase SDKs | 3351-3360 |
| Estado inicial (`state`) | 4636-4760 |
| PERSIST_KEYS | 4768 |
| SYNCED_COLLECTIONS | 4779 |
| FINANCE_KEYS | 4808 |
| CONFIG_KEYS | 4816 |
| saveState() | 4881 |
| syncCollections() | 4976 |
| subscribeCollectionsSync() | 5013 |
| activeAppointments() | 5499 |
| Permisos (PERMISSIONS) | 5392 |
| renderCommand() | 5514 |
| renderClients() | 5661 |
| renderCash() | 6501 |
| renderCashKpis() | 6514 |
| fillSaleSourceOptions() | 6799 |
| registerSale() / registerSale flow | 7047 |
| renderLedger() | 7204 |
| renderAgenda() | 7505 |
| renderAppt() | 7650 |
| cancelAppointment() | 7790 |
| reactivateAppointment() | 7799 |
| openPopover() | 7856 |
| updateApptStatus() | 7976 |
| editAppointment() | 7928 |
| addAppointmentServiceLine() | 8309 |
| openClientProfile() | 8739 |
| RRHH | 8928 |
| Finanzas | 9318 |
| State mutation functions | 9758 |
| Comunicaciones | 9871 |
| Athenas IA | 10561 |
| renderAll() | 10994 |
| Blocker drawer | 11005 |
| Mini-calendario | 11145 |
| bootAppData() | 11250 |
| ACTION_MAP | ~11400 |
| Event delegator | ~11496 |

## Email del sistema

- Remitente: **glambbelgrano@gmail.com** (SMTP Gmail con contraseña de aplicación, extensión "Trigger Email from Firestore").
- Cola de emails: colección `mail`.
- Deduplicación de recordatorios: colección `sentReminders`.
