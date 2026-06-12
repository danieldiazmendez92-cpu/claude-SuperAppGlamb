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
| Último commit | `99ab01e` |
| Publicación futura | Firebase Studio (después de estabilizar flujos) |

---

## Arquitectura

Single-file HTML (~5400 líneas) con CSS y JS embebidos. Sin framework, sin build step. Estado persistido en `localStorage`.

---

## Módulos

| Módulo | Estado |
|--------|--------|
| Centro de Mando | ✅ KPIs + alertas Katy |
| Clientes / CRM | ✅ Perfil, historial, preferencias, edición |
| Equipo & Accesos | ✅ Colaboradoras + disponibilidad por día + edición |
| Catálogo | ✅ Grupos → Servicios → Variantes + Adicionales |
| Agenda desktop | ✅ Grilla por profesional, drag & drop, combinados, horarios visibles |
| Agenda móvil | ✅ Vista panorámica (archivo separado) |
| Ventas & Caja | ✅ POS + centro financiero diario |

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

Inspiración visual agenda: **Fresha** — bloques limpios con jerarquía hora/cliente/servicio.

---

## Flujos principales implementados

### Reserva → Venta
Una reserva con `bookingId` puede tener N servicios y N adicionales.
Al cobrar desde Agenda → Caja, se precargan todas las líneas + adicionales + seña en un único ticket.

### Seña → Cobro parcial
La seña se registra al crear el turno o desde Caja (tipo `deposit_received`).
Al registrar la venta: `Total − Seña = Saldo a cobrar hoy`.
Si se paga menos del saldo, se auto-crea un `pendingCharge` por el resto.

### Centro financiero diario
Apertura → Cobros → Retiros → Gastos → Cierre con diferencia efectivo.
KPIs: ingresó hoy, efectivo esperado, gastos+retiros, desglose por método.

---

## Cambios clave de la sesión actual

### Edición de colaboradoras
- Drawer de edición pre-carga todos los datos: nombre, tipo, chips de servicios, horario por día
- Chips de servicio se pre-seleccionan aunque el colaborador tenga datos legacy (solo `groups` por nombre)
- `saveCollaborator` guarda `schedule: {Día: {start, end}}` para cada día marcado
- `refreshAgendaFilters` verifica `c.can` al restaurar el filtro — evita agenda vacía al cambiar el estado

### Horario visible en agenda
- Cada columna muestra sombreado rayado diagonal para horas fuera del turno de la colaboradora
- Si el día no es laboral para esa profesional, la columna entera aparece sombreada
- Usa `m.schedule[día]` para el horario del día exacto, con fallback a `m.hours`

### Rediseño visual de agenda (inspirado en Fresha)
- Headers con avatar circular + nombre centrado debajo
- Bloques de turno: `hora – cliente` arriba (bold), servicio abajo (regular)
- Colores pasteles por grupo con borde izquierdo de 3px
- Huecos invisibles hasta hover (muestra `+` al pasar el mouse)
- Bloqueos con rayado diagonal
- Línea de "ahora" roja con punto circular y etiqueta de hora

### Navegación de fecha
- Clic sobre la fecha del toolbar (`vie 12 jun`) abre el selector de fecha nativo del OS
- Permite saltar a cualquier fecha sin navegar día por día

### Correcciones de bugs
- `voidTicket` ahora marca todos los pagos del ticket como `p.voided=true` → KPIs no los cuentan
- `savePendingSale` vincula el turno de origen (`appointmentId`, `reservationId`)
- `dropAppointment` actualiza `a.date` al soltar en la grilla
- Popover de turno muestra el monto correcto (precio + desglose seña/saldo)
- Edición de clientes: drawer precargado, guardado con `editingClientId`
- Cascade select de servicios restaura variante, duración y precio al editar

---

## Modelo de datos clave

```js
// Colaboradora
{
  id, first, last, phone, email, type, can,
  groups: ['Manicuria'],       // nombres (display)
  groupIds: ['cat123'],        // IDs del catálogo
  serviceIds: ['svc1','svc2'],
  days: 'Lunes, Martes, ...',  // días laborables
  hours: '10:00 - 19:00',      // horario global (display en equipo)
  schedule: {                  // horario por día (agenda)
    'Lunes': { start: '10:00', end: '19:00' },
    'Martes': { start: '12:00', end: '20:00' }
  }
}

// Turno
{
  id, bookingId, date,        // date = 'YYYY-MM-DD'
  memberId, clientId,
  group, service, variantId, serviceId,
  start, end,                 // 'HH:MM'
  status, deposit, depositAmount, depositMethod,
  price, isAdditional, note
}

// Pago
{
  id, ticketId, type, method, amount, date, voided
}
```

---

## Reglas de trabajo

1. **Todo cambio va a `glamb-os-working-v6.html`**
2. `glamb-os-stable.html` no se modifica sin aprobación explícita
3. Los commits deben tener autor `Claude <noreply@anthropic.com>` — el stop-hook lo verifica
4. Ver `glamb-project-current-state.md` para contexto adicional
5. Push siempre a `claude/stoic-allen-o372la` vía PAT

---

## Archivos del repositorio

| Archivo | Descripción |
|---------|-------------|
| `glamb-os-working-v6.html` | **Archivo de trabajo activo** (~5400 líneas) |
| `glamb-os-stable.html` | Copia inicial estable (no modificar) |
| `glamb-project-current-state.md` | Estado detallado del proyecto |
| `glamb-change-control.md` | Reglas de control de cambios |
| `glamb-protected-features.md` | Funcionalidades protegidas |
| `glamb-qa-checklist.md` | Checklist de QA |
| `glamb-visual-agent.md` | Guía de identidad visual |
| `glamb-functional-audit-agent.md` | Guía de auditoría funcional |
