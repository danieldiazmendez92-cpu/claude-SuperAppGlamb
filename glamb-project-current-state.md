# GLAMB OS — Estado actual del proyecto

## Para continuar en una conversación nueva

Pegá esto como primer mensaje en el nuevo chat:

```txt
Continuemos el proyecto GLAMB OS.
Repo: danieldiazmendez92-cpu/claude-SuperAppGlamb
Branch de trabajo: claude/stoic-allen-o372la
Archivo de trabajo: glamb-os-working-v6.html (único archivo activo, ~5200 líneas)
Último commit: b673413
Push via PAT: usar el token de GitHub guardado (ver settings del repo o pedirle al usuario)
Leé glamb-project-current-state.md para contexto completo.
```

---

## Arquitectura

- **Single-file HTML** con CSS y JS embebidos (~5200 líneas)
- Sin framework, sin build step, corre directo en el browser
- Estado persistido en `localStorage` bajo key `glamb-os-state-v1`
- `PERSIST_KEYS`: clients, collaborators, appointments, blockers, waitlist, payments, salesTickets, pendingCharges, catalog, cashSession, cashMode, cashCurrentCollaboratorId

---

## Archivo de trabajo activo

`glamb-os-working-v6.html` — todos los cambios van aquí. `glamb-os-stable.html` es copia inicial, no modificar sin aprobación.

---

## Identidad visual (B&W Premium)

```css
--bg: #F6F6F4
--surface: #FBFBFA
--surface-2: #EFEFEC
--text: #0E0E0D
--text-muted: #666662
--text-soft: #94948E
--line: #E3E3DF
--accent: #0E0E0D
--radius-card: 20px
--radius-pill: 999px
```

Tipografía: `Cormorant` (títulos/KPIs) + `DM Sans` (UI)

---

## Módulos implementados

### 1. Centro de Mando
KPIs: venta servicios, pendiente cobro, turnos hoy, huecos, clientes en riesgo.
Alertas operativas con recomendaciones. Últimos turnos del día.

### 2. Clientes / CRM
Crear/buscar clientes. Código único GL-XXXXXX. WhatsApp obligatorio, email opcional.
Perfil con historial, preferencias, nota clave, tier (Muse/Black/Diamond).
Alta rápida desde Agenda.

### 3. Equipo & Accesos
Crear colaboradoras. Servicios habilitados por grupos del catálogo.
Disponibilidad por día. Flag "recibe turnos".

### 4. Catálogo
Grupos → Servicios → Variantes (precio + duración).
Adicionales globales. Productos con stock.
3 vistas: grid, lista, compacta. CRUD completo.

### 5. Agenda desktop
- Grilla por profesional con eje horario fijo
- Bloques por color de grupo (manicuria gris, eyes azul, depi verde, extras beige)
- Texto adaptativo por altura del bloque (client: >52px, time: >82px, flags: >100px)
- Línea de "ahora" animada
- Toolbar colapsible con botón "⚙ Filtros"
- Crear turno con múltiples servicios + adicionales como checkboxes
- Seña al crear turno (monto + método)
- Drag & drop de turnos entre profesionales/horarios
- Zoom de columnas: 100/120/140/160/190px
- Popover redesñado: close button ×, servicios combinados en tabla compacta, posicionamiento inteligente
- `chargeFromAppointment(id)`: puente Agenda → Caja con datos prellenados

### 6. Ventas & Caja
**Checkout unificado** (no por línea):
- Panel: Total visita → − Seña abonada → = Saldo a cobrar
- Chips de método de pago + monto
- Pago mixto (segundo método)
- Pago parcial → auto-crea pendingCharge por saldo

**Registro de venta:**
- Fuente: turno en agenda / cliente existente / cliente nuevo
- Al cobrar desde turno: pre-carga servicios + adicionales del booking
- Adicionales pre-seleccionados como chips desde `catalog.additionals`
- Precio viene del catálogo actual (no del precio guardado en turno)
- `registerSale`: ticket con status confirmed/partial
- `savePendingSale`: guarda sin cobrar

**Centro financiero:**
- 5 KPIs operativos: ingresó hoy, efectivo esperado, gastos+retiros, por método
- Resumen en dark panel negro
- Registrar seña standalone (tipo deposit_received)
- Registrar gasto (categoría + método + nota)
- Registrar retiro
- Pendientes de cobro (injectPending)
- Tickets del día con estado confirmed/partial/voided
- Apertura/cierre de caja con diferencia efectivo

### 7. Agenda Móvil
Archivo separado: `glamb-mobile-agenda-glamb-style.html` (iframe embebido)

---

## Funciones clave del JS

| Función | Descripción |
|---------|-------------|
| `reservationKey(appt)` | bookingId o id como fallback |
| `reservationAppointments(appt)` | todos los no-adicionales del mismo booking |
| `reservationDeposit(appts)` | máximo depositAmount del grupo |
| `selectSaleAppointment(id)` | precarga líneas + adicionales + precio catálogo en Caja |
| `chargeFromAppointment(id)` | Agenda→Caja prellenado |
| `registerSale()` | crea ticket, payments, pendingCharge si parcial |
| `saleTotals()` | grossTotal, depositApplied, due, payments |
| `cashExpectedAmount()` | apertura + cashIn - retiros - gastos efectivo |
| `renderCashDaily()` | desglose financiero del día |
| `editAppointment(id)` | abre drawer con datos del turno (solo mainLines, no adicionales) |
| `addAppointmentServiceLine()` | agrega línea al drawer de turno (null-safe en firstVar) |
| `toggleAgendaFilters()` | colapsa/expande segunda fila del toolbar |

---

## Modelo de datos — Appointment

```js
{
  id, bookingId,          // bookingId agrupa todos los servicios de una visita
  date,                   // YYYY-MM-DD
  memberId, clientId,
  group, service,         // nombre legible
  variantId, serviceId,   // IDs del catálogo
  start, end, duration,
  price,                  // precio del servicio
  status,                 // confirmed | in_progress | completed | cancelled | no_show
  deposit,                // 'paid' | 'pending' | 'none'
  depositAmount,          // en el primer servicio del booking
  bookingDepositAmount,   // en todos los del booking
  depositMethod,
  note,
  isAdditional            // true = adicional del catálogo, no servicio principal
}
```

---

## Modelo de datos — SalesTicket

```js
{
  id, clientId, clientNameSnapshot,
  appointmentId, reservationId,
  origin,                 // 'appointment' | 'existing' | 'new'
  status,                 // 'confirmed' | 'partial' | 'voided'
  lines: [{collaboratorId, group, service, variantId, addons, finalPrice, tipAmount}],
  servicesTotal, tipsTotal, grossTotal,
  depositAppliedTotal,
  totalDueToday, amountToCollectToday, pendingBalance,
  createdBy, createdAt
}
```

---

## Bugs resueltos en esta sesión

| # | Bug | Fix |
|---|-----|-----|
| 1 | Adicionales no viajan Agenda→Caja | `selectSaleAppointment` pre-selecciona chips de `catalog.additionals` |
| 2 | Service select siempre muestra Kapping | `bindAppointmentServiceLine`: querySelectorAll solo en inputs, no en selects |
| 3 | Texto superpuesto en bloques de agenda | Flex column + umbrales por altura (52/82/100px) + nowrap |
| 4 | Toolbar ocupa demasiado espacio | Segunda fila colapsible con "⚙ Filtros" |
| 5 | Popover combinado feo, no llega a botones | Rediseño con tabla compacta + posicionamiento inteligente |
| 6 | `editAppointment` crasheaba silenciosamente | Filtrar `!isAdditional` antes de crear líneas; `firstVar` null-safe |
| 7 | `saleAddons` hardcodeado desconectado del catálogo | Reemplazado por `state.catalog.additionals` |
| 8 | `pop.style.left/top` nunca se asignaban | Agregados después de calcular posición |
| 9 | Precios de catálogo no se usaban en Caja | `getVariantFromId().variant.price` como primera opción |
| 10 | Colores residuales terracota/beige | CSS: danger buttons rojo neutro, side-note B&W, cash kpis alineados |

---

## Bugs pendientes conocidos

| # | Bug | Descripción |
|---|-----|-------------|
| 1 | Doble cobro posible | `registerSale` no verifica si ya existe ticket para ese `reservationId` |
| 2 | `voidTicket` no revierte payments | Los payments asociados siguen sumando en KPIs |
| 3 | Drag & drop no actualiza `a.date` | Mover turno puede dejar fecha inconsistente |
| 4 | Seña manual en Caja no auto-rellena | `deposit_received` no se detecta en `selectSaleAppointment` |
| 5 | Datos viejos en localStorage | Turnos creados con el bug del service select tienen variantIds incorrectos |

---

## Reglas de trabajo

1. Todo cambio va a `glamb-os-working-v6.html`
2. Nunca tocar `glamb-os-stable.html` sin aprobación
3. Push via PAT al branch `claude/stoic-allen-o372la`
4. Los commits aparecen como "Unverified" en GitHub — es normal, el entorno no tiene GPG. No requiere acción.

---

## Pendientes de roadmap (no urgentes)

- Agenda mobile: rediseño estructural del layout en pantallas chicas
- Caja en mobile: el checkout queda debajo de las líneas, hay que reorganizar
- KPI principal del Dashboard con escala diferenciada
- Toasts de alerta persistentes (cierre manual)
- Vista semana completa en Agenda
- Guard anti-doble cobro en `registerSale`
