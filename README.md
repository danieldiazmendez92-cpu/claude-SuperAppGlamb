# GLAMB OS

**GLAMB OS** es una app interna para operar GLAMB como un sistema operativo del salon: clientes, agenda, equipo, ventas, caja, pendientes, tickets y centro de mando en un mismo flujo.

La app no debe sentirse como un sistema administrativo generico. Debe sentirse premium, clara, rapida y util para la operacion real de GLAMB.

---

## Estado operativo actual

**Etapa:** prototipo HTML funcional + definicion operativa.  
**Publicacion futura:** Firebase Studio / Firebase, despues de estabilizar flujos y experiencia.  
**Archivo estable historico:** `glamb-os-stable (1).html`  
**Archivo de trabajo actual:** `glamb-os-working-v6 (1).html`  
**Resumen maestro:** `glamb-project-current-state.md`

Regla vigente:

> Todo cambio se hace primero en el archivo de trabajo y solo se integra al estable con aprobacion explicita del usuario.

---

## Ultimos cambios en working v6

### Reserva -> Venta

Se corrigio el puente operativo entre Agenda y Caja:

- Una reserva combinada se identifica por `bookingId`.
- Al elegir un turno de agenda en Caja, se agrupan todos los servicios de la misma reserva.
- Caja precarga una sola venta con multiples lineas.
- El ticket guarda trazabilidad con `appointmentId`, `reservationId` y `origin`.
- La sena/anticipo de la reserva se aplica una sola vez al ticket.

Objetivo:

```txt
Reserva #1458
Cliente: Maria
Servicios:
- Semipermanente
- Perfilado
- Lifting

Venta #879
Origen: Reserva #1458
```

No debe crear tres ventas separadas.

### Katy / Centro de Mando

Katy dejo de ser solo decorativa y ahora muestra senales operativas:

- Clientas en riesgo.
- Huecos vendibles.
- Colaboradoras bajo objetivo.
- Pendientes de cobro.
- Venta de servicios confirmada.

### Agenda 70%

La Agenda desktop/tablet fue ajustada para ocupar aproximadamente el 70% real de la pantalla:

- `#page-agenda` usa layout vertical.
- `.agenda-shell` tiene `min-height: 70vh`.
- `.calendar-wrap` tiene `min-height: 70vh`.
- El encabezado de Agenda es mas compacto.
- Hay ajuste responsive para mobile/tablet.

No se modifico la logica de turnos, filtros, solapamientos ni creacion de citas.

---

## Reglas de trabajo

Documentos de control:

- `glamb-change-control.md`
- `glamb-protected-features.md`
- `glamb-qa-checklist.md`

Antes de ejecutar cambios se debe informar:

```txt
Tipo de cambio:
Modulos afectados:
Funciones protegidas involucradas:
Riesgos:
Archivo de trabajo:
Requiere aprobacion explicita?: Si/No
```

Si un cambio toca una funcionalidad protegida, se debe pedir aprobacion explicita antes de modificarla.

---

## Funcionalidades protegidas principales

- Navegacion entre Centro, Clientes, Agenda, Caja, Catalogo y Equipo.
- Crear cliente.
- Cliente con WhatsApp como dato principal.
- Agenda por horarios y profesionales.
- Crear turno / cita.
- Crear cita desde hueco.
- Turno con multiples servicios.
- Un bloque de agenda por servicio/profesional.
- Sena en turno.
- Sena como anticipo aplicado en venta.
- Ventas & Caja tipo GLAMB Ledger.
- Multiples lineas por venta.
- Colaboradora por linea.
- Propina por linea.
- Pago mixto.
- Pendientes de cobro.
- Apertura, retiros y cierre de caja.
- Tickets del dia.
- Servicios agrupados por familias.
- Disponibilidad por dia.

---

## Vision del producto

GLAMB OS debe conectar:

```txt
Cliente
Agenda
Reserva
Equipo / Colaboradoras
Venta
Caja
Tickets / Pendientes
Centro de mando / Katy
```

El objetivo no es tener pantallas sueltas, sino que todo alimente la operacion real del salon.

---

## Modulos actuales

### 1. Centro de Mando

Objetivo: ver que esta pasando en GLAMB en pocos segundos.

Incluye:

- KPIs del dia.
- Venta de servicios.
- Pendientes de cobro.
- Turnos del dia.
- Huecos vendibles.
- Alertas de Katy.
- Oportunidades operativas.

### 2. Clientes / CRM

Objetivo: centralizar la memoria comercial y de experiencia de cada cliente.

Incluye:

- Crear cliente.
- WhatsApp como dato principal.
- Email opcional.
- Codigo unico automatico.
- Perfil de cliente.
- Preferencias.
- Nota clave.
- Historial de turnos.
- Marcar VIP.
- Crear turno desde cliente.

### 3. Equipo & Accesos

Objetivo: definir quien trabaja, que servicios puede hacer y cuando esta disponible.

Incluye:

- Crear colaboradora.
- Diferenciar colaboradora de usuario.
- Servicios agrupados por familias.
- Disponibilidad por dia con inicio y fin.
- Indicar si puede recibir turnos.

Decisiones vigentes:

- No usar niveles GLAMB.
- No pedir Instagram como campo obligatorio de colaboradora.
- Los servicios deben estar agrupados por familias.

### 4. Agenda desktop / tablet

Objetivo: operar el calendario completo del salon.

Incluye:

- Agenda como superficie principal de trabajo.
- Horarios a la izquierda.
- Profesionales por columnas.
- Turnos como bloques.
- Bloqueos.
- Filtros por profesional y grupo.
- Intervalos 15 / 30 / 60 minutos.
- Vista dia / lista / semana.
- Linea de ahora.
- Popover de detalle.
- Estados de turno.
- Crear turno.
- Crear turno desde hueco.
- Validacion de solapamientos.
- Turno con multiples servicios.
- `bookingId` para representar una reserva combinada.

### 5. Agenda movil

Archivo de referencia visual:

`glamb-mobile-agenda-glamb-style.html`

Incluye:

- Vista panoramica movil.
- Horarios a la izquierda.
- Profesionales por columnas.
- Turnos como bloques.
- Bloqueos / horarios no disponibles.
- Bottom nav.
- Crear nueva cita.
- Crear cita tocando un hueco.
- Identidad GLAMB, sin copiar literalmente Fresha.

Decision:

> La app final debe tener una sola Agenda adaptada por dispositivo, no dos modulos principales duplicados.

### 6. Ventas & Caja

Objetivo: adaptar el flujo real de GLAMB Ledger.

La venta real de GLAMB no es solo un pago. Es un ticket con una o mas lineas.

Incluye:

- Apertura de caja con monto inicial obligatorio.
- Registrar retiro.
- Cierre con efectivo esperado vs contado.
- Origen de venta:
  - Turno/reserva en agenda.
  - Cliente existente sin turno.
  - Cliente nuevo.
- Cliente obligatorio.
- Cliente nuevo abre creacion de cliente.
- Una o mas lineas de servicio.
- Colaboradora por linea.
- Servicio por linea.
- Precio editable.
- Grupo inferido por servicio.
- Sena visible por linea.
- Sena como anticipo aplicado.
- Propina por linea.
- Adicionales colapsados.
- Pago por linea.
- Pago mixto por linea.
- Guardar para cobrar despues.
- Pendientes de cobro.
- Cobrar pendiente inyectandolo al formulario.
- Tickets del dia.
- Anular ticket.
- Caja del dia.
- Movimientos por medio.

Personas con administracion de caja actual:

- Daniel.
- Ezequiel.
- Giuli.

### 7. Catalogo

Objetivo: administrar familias, servicios, variantes, adicionales y productos.

Incluye:

- Familias de servicios.
- Servicios por familia.
- Variantes con precio y duracion.
- Adicionales.
- Productos para venta directa.

---

## Archivos principales del workspace actual

- `glamb-os-working-v6 (1).html` - archivo de trabajo actual.
- `glamb-os-stable (1).html` - version estable historica disponible en este workspace.
- `glamb-project-current-state.md` - resumen maestro del proyecto.
- `glamb-change-control.md` - reglas de control de cambios.
- `glamb-protected-features.md` - mapa de funcionalidades protegidas.
- `glamb-qa-checklist.md` - checklist de QA.
- `glamb-visual-agent.md` - guia visual.
- `glamb-functional-audit-agent.md` - guia de auditoria funcional.

---

## Proximos pasos recomendados

1. Probar manualmente Agenda despues del ajuste al 70%.
2. Probar Caja con una reserva combinada:
   - dos o tres servicios,
   - dos profesionales,
   - sena,
   - pago restante,
   - ticket unico.
3. Revisar rentabilidad real:
   - cuanto gano GLAMB hoy,
   - que servicio deja mas plata,
   - que colaboradora es mas rentable.
4. Redisenar Caja como POS moderno.
5. Convertir colaboradoras en unidades economicas:
   - facturacion,
   - comisiones,
   - propinas,
   - servicios,
   - ocupacion,
   - productividad.
6. Avanzar hacia identidad visual GLAMB 2.0 sin romper funciones protegidas.

---

## Nota operativa

Si un cambio visual rompe navegacion, caja, agenda o ventas, se considera regresion funcional.

El objetivo es avanzar sin volver a romper funciones ya aprobadas.
