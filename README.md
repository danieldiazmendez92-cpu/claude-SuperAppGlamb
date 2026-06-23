# GLAMB OS

**GLAMB OS** es el sistema operativo interno de GLAMB: clientes, agenda, equipo, catálogo, ventas y caja en un solo flujo premium.

No debe sentirse como un sistema administrativo genérico. Debe sentirse como una herramienta de dirección de un salón de belleza premium.

---

## Estado actual

| Dato | Valor |
|------|-------|
| Etapa | Prototipo HTML funcional |
| Archivo de trabajo | `glamb-os-working-v6.html` |
| Branch | `claude/beautiful-fermat-l5mac7` |
| Líneas aprox. | ~8600 |
| Publicación futura | Backend Firebase (Firestore + Auth + Hosting) |

> ⚠️ **El prototipo NO está listo para producción ni para datos reales sensibles.**
> El login y el enmascarado de datos (teléfono/email por rol) son de **presentación**:
> todo el estado vive en el `localStorage` del navegador, así que un usuario técnico
> puede leerlo desde la consola. La protección **real** —filtrado server-side por rol,
> autenticación y datos cifrados— llega con la migración a **Firebase Auth + security
> rules**. Hasta completar esa etapa, el sistema es solo una demostración funcional.

---

## Arquitectura

Single-file HTML (~8100 líneas) con CSS y JS embebidos. Sin framework, sin build step. Estado persistido en `localStorage`.

Todo el JS vive dentro de un único IIFE. Los handlers usan `data-action` + `ACTION_MAP` — nunca `onclick=` inline. Las mutaciones de estado pasan por funciones centralizadas (`addPayment`, `addAppointment`, `addClient`, etc.).

---

## Módulos

| Módulo | Estado |
|--------|--------|
| Centro de Mando | ✅ KPIs + alertas automáticas + Athenas (asistente IA) |
| Clientes / CRM | ✅ Perfil, historial con filtros, insights automáticos, tags predictivos, eliminar cliente |
| Equipo & Accesos | ✅ Colaboradoras + disponibilidad + edición + eliminar colaborador |
| Catálogo | ✅ Grupos → Servicios → Variantes + Adicionales + propagación de cambios |
| Agenda | ✅ Vista día + vista semana, drag & drop, bloques premium, popover con acciones, eliminar turno |
| Ventas & Caja | ✅ Wizard 3 pasos + apertura/cierre/arqueo + registro de gastos + retiros |
| RRHH | ✅ Liquidaciones + comisiones + deducibles + presentismo/viático editables |
| Finanzas | ✅ Libro contable, presupuesto mensual por categoría con alertas visuales |

---

## Usuarios y permisos (prototipo)

Tres roles. El acceso se deriva del rol del usuario logueado — reemplaza al viejo toggle manual "modo de caja".

| Módulo | 🟢 Admin (Daniel, Eze) | 🟡 Medio (Recepción) | 🔴 Bajo (Colaboradora) |
|--------|------------------------|----------------------|------------------------|
| Centro de Mando | Completo (con $) | Simplificado, sin montos | Mínimo |
| Agenda | Todos los días | Solo día actual | Solo día actual |
| Clientes / CRM | Completo (ve datos) | Agendar/consultar, **sin email/tel** | Sin módulo |
| Caja / Ventas | Completo | Todos los registros | Solo registrar venta |
| Catálogo / Equipo / RRHH / Finanzas | Completo | — | — |

- Login por PIN (demo): Daniel `1111`, Eze `2222`, Recepción `3333`, Ana `4444`.
- `PERMISSIONS[rol]` define páginas, vista de agenda, visibilidad de datos, alcance de caja y nivel de Centro.
- `applyPermissions()` aplica los gates en cada `renderAll()`; `showPage()` bloquea módulos no permitidos.
- **Recordatorio de seguridad:** el enmascarado es cosmético hasta Firebase (ver advertencia arriba).

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
Apertura → Cobros → Retiros → Gastos → Cierre con diferencia efectivo en tiempo real.
KPIs: ingresó hoy, efectivo esperado, gastos+retiros, desglose por método.

### Liquidación de colaboradora
RRHH → seleccionar colaboradora → período → revisar comisiones → editar presentismo/viático → guardar → marcar como pagada.

---

## Funcionalidades destacadas

### Athenas — Asistente inteligente
Panel en Centro de Mando. Calcula en tiempo real:
- Saludo contextual según la hora del día
- Clientes en riesgo de abandono (≥28 días sin visita, no en agenda hoy)
- Huecos en la agenda del día por profesional
- Alertas de cobros pendientes
- Botones de copia para enviar por WhatsApp con un clic

### CRM con insights automáticos
`clientInsights(clientId)` calcula:
- Ticket promedio, frecuencia de visita, días desde última visita, gasto total, servicio más solicitado
- Tags predictivos: **Riesgo de abandono** (>45 días), **Frecuente** (<21 días), **Alto valor**

### Agenda dual (día / semana)
- **Vista día**: columnas por profesional con bloques de diseño premium
- **Vista semana**: grilla 7 columnas (Lun–Dom), hoy resaltado, navegación ±7 días
- Bloques adaptativos: 4 niveles de densidad según la altura disponible (28px / 44px / 56px / 82px+)
- Pill de estado coloreado, barra de ocupación por colaboradora

### Presupuesto mensual (Finanzas)
Barras por categoría de gasto. Verde < 80%, naranja 80–99%, rojo ≥ 100%. Límite editable con un clic.

### Wizard 3 pasos en Caja
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

// Liquidación
{
  id, memberId, periodLabel, periodStart, periodEnd,
  commissions, deductions, presentismo, viatico,
  totalCommissions, totalDeductions, grossPay, netPay,
  status, // 'draft' | 'paid'
  createdAt
}
```

---

## Reglas de trabajo

1. **Todo cambio va a `glamb-os-working-v6.html`**
2. `glamb-os-stable.html` no se modifica sin aprobación explícita
3. Los commits deben tener autor `Claude <noreply@anthropic.com>` — el stop-hook lo verifica
4. **Una sola rama de trabajo activa**: `claude/beautiful-fermat-l5mac7`. Si una sesión nueva asigna otra rama, avisar y mergear antes de trabajar — no dispersar commits
5. Antes de cada commit: `git config user.email noreply@anthropic.com && git config user.name Claude`
6. Todo handler nuevo usa `data-action` + `ACTION_MAP` — nunca `onclick=` inline
7. Todo JS dentro del IIFE existente — sin funciones globales sueltas

---

## Archivos del repositorio

| Archivo | Descripción |
|---------|-------------|
| `glamb-os-firebase.html` | **Versión en migración a Firebase** (Auth + Firestore). Ver `MIGRATION.md` |
| `glamb-os-working-v6.html` | Prototipo localStorage (respaldo, abre como archivo) |
| `glamb-os-stable.html` | Copia estable (sincronizar manualmente) |
| `caja-mockups.html` | 4 mockups de diseño del módulo Caja (referencia) |
| `MIGRATION.md` | Guía paso a paso de la migración a Firebase |
| `firestore.rules` | Reglas de seguridad de Firestore (Fase A) |
| `firebase.json` / `.firebaserc` | Config de deploy (Hosting + Firestore) |
