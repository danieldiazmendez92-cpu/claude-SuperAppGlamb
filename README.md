# GLAMB OS

**GLAMB OS** es el sistema operativo interno de GLAMB: clientes, agenda, equipo, catálogo, ventas y caja en un solo flujo premium.

No debe sentirse como un sistema administrativo genérico. Debe sentirse como una herramienta de dirección de un salón de belleza premium.

---

## Estado actual

| Dato | Valor |
|------|-------|
| Etapa | Prototipo HTML funcional |
| Archivo de trabajo | `glamb-os-working-v6.html` |
| Branch | `claude/stoic-allen-o372la` |
| Último commit | `3fdbddf` |
| Líneas aprox. | ~6200 |
| Publicación futura | Firebase Studio (después de estabilizar flujos) |

---

## Arquitectura

Single-file HTML (~6200 líneas) con CSS y JS embebidos. Sin framework, sin build step. Estado persistido en `localStorage`.

---

## Módulos

| Módulo | Estado |
|--------|--------|
| Centro de Mando | ✅ KPIs + alertas automáticas |
| Clientes / CRM | ✅ Perfil, historial, insights automáticos, tags predictivos |
| Equipo & Accesos | ✅ Colaboradoras + disponibilidad por día + edición |
| Catálogo | ✅ Grupos → Servicios → Variantes + Adicionales |
| Agenda | ✅ Grilla por profesional, drag & drop, bloques de horario, popover con acciones |
| Ventas & Caja | ✅ Wizard 3 pasos + centro financiero diario |

---

## Identidad visual — B&W Premium

```
Background:  #F6F6F4
Surface:     #FBFBFA
Surface 2:   #EFEFEC
Text:        #0E0E0D
Muted:       #666662
Soft:        #94948E
Border:      #E3E3DF
```

Tipografía: **Cormorant** (títulos) + **DM Sans** (UI)

---

## Flujos principales implementados

### Reserva → Venta
Una reserva con `bookingId` puede tener N servicios y N adicionales.
Al cobrar desde Agenda → Caja, se precargan todas las líneas + adicionales + seña en un único ticket.

### Seña → Cobro
La seña se registra contra el **cliente** (sin requerir turno previo).
`clientAvailableDeposit(clientId)` calcula el saldo disponible = recibido − aplicado.
Al abrir una venta para ese cliente, la seña se pre-rellena automáticamente.
Si se paga menos del saldo, se auto-crea un `pendingCharge` por el resto.

### Centro financiero diario
Apertura → Cobros → Retiros → Gastos → Cierre con diferencia efectivo.
KPIs: ingresó hoy, efectivo esperado, gastos+retiros, desglose por método.

---

## Funcionalidades destacadas

### CRM con insights automáticos
`clientInsights(clientId)` calcula en tiempo real:
- Ticket promedio, frecuencia de visita, días desde última visita, gasto total
- Tags predictivos: **Riesgo de abandono** (>45 días sin visita), **Frecuente** (<21 días), **Alto valor** (gasto alto)

### Wizard 3 pasos en Caja
El módulo de registro de ventas usa un wizard guiado:
1. **Cliente** — tarjetas grandes: turno en agenda / cliente existente / cliente nuevo
2. **Servicios** — líneas de venta + nota interna
3. **Cobro** — opciones de pago (paga todo / parcial / pendiente) + métodos

Paper ticket sticky en pasos 2 y 3 que se actualiza en tiempo real.

### Bloques de horario en Agenda
Las colaboradoras pueden tener bloqueos de tiempo (almuerzo, descanso, etc.):
- Recurrentes (sin fecha) o de un día específico
- Se crean/editan/eliminan desde la agenda
- Se muestran con fondo rayado diagonal y etiqueta

### Propagación de cambios en Catálogo
Al editar precio o nombre de un adicional, el sistema detecta los turnos afectados y ofrece actualizar el precio en agenda y caja.

---

## Modelo de datos clave

```js
// Colaboradora
{
  id, first, last, phone, email, type, can,
  groups: ['Manicuria'],
  groupIds: ['cat123'],
  serviceIds: ['svc1','svc2'],
  days: 'Lunes, Martes, ...',
  hours: '10:00 - 19:00',
  schedule: {
    'Lunes': { start: '10:00', end: '19:00' }
  }
}

// Turno
{
  id, bookingId, date,
  memberId, clientId,
  group, service, variantId, serviceId,
  start, end,
  status, deposit, bookingDepositAmount,
  price, isAdditional, note
}

// Bloqueo de horario
{
  id, memberId, start, end, label,
  date   // opcional — si está ausente es recurrente
}

// Pago
{
  id, ticketId, clientId,
  type,   // 'deposit_received' | 'deposit_applied' | 'service'
  method, amount,
  reference, note, createdAt
}

// Ticket de venta
{
  id, clientId, appointmentId, origin, status,
  lines, servicesTotal, tipsTotal, grossTotal,
  depositAppliedTotal, totalDueToday, pendingBalance,
  createdBy, createdAt
}
```

---

## Reglas de trabajo

1. **Todo cambio va a `glamb-os-working-v6.html`**
2. `glamb-os-stable.html` no se modifica sin aprobación explícita
3. Los commits deben tener autor `Claude <noreply@anthropic.com>` — el stop-hook lo verifica
4. Push siempre a `claude/stoic-allen-o372la` vía PAT
5. Antes de cada commit: `git config user.email noreply@anthropic.com && git config user.name Claude`

---

## Archivos del repositorio

| Archivo | Descripción |
|---------|-------------|
| `glamb-os-working-v6.html` | **Archivo de trabajo activo** (~6200 líneas) |
| `glamb-os-stable.html` | Copia estable (sincronizar manualmente) |
| `caja-mockups.html` | 4 mockups de diseño del módulo Caja (referencia) |
