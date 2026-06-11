# GLAMB OS — Mapa de funcionalidades protegidas

## Regla principal

Las funcionalidades listadas en este documento están protegidas.

No pueden eliminarse, modificarse ni reemplazarse sin aprobación directa y explícita del usuario.

La aprobación debe ser taxativa, por ejemplo:

```txt
Apruebo modificar [nombre de funcionalidad protegida].
```

Si un cambio propuesto toca una funcionalidad protegida, el asistente debe detenerse y pedir aprobación antes de ejecutar.

---

# Funcionalidades protegidas por módulo

## 1. Navegación general

### Protegido

- Navegación entre Centro, Clientes, Agenda, Caja y Equipo.
- Navegación responsive cuando la sidebar se oculta.
- Acceso a Agenda desde el menú.
- Acceso a Caja desde el menú.
- Acceso a Clientes desde el menú.
- Acceso a Equipo desde el menú.

### No se puede hacer sin aprobación

- Eliminar módulos del menú.
- Duplicar módulos principales sin justificación.
- Ocultar navegación en mobile/tablet.
- Cambiar nombres principales de módulos.

---

## 2. Clientes / CRM

### Protegido

- Crear cliente.
- Buscar cliente.
- Cliente con WhatsApp como dato principal.
- Perfil de cliente.
- Preferencias/tags.
- Nota clave.
- Crear turno desde cliente.
- Marcar cliente como VIP.

### No se puede hacer sin aprobación

- Eliminar WhatsApp.
- Eliminar creación de cliente.
- Reemplazar cliente por texto libre únicamente.
- Quitar notas/preferencias.
- Quitar vínculo Cliente → Agenda.

---

## 3. Equipo & Accesos

### Protegido

- Crear colaboradora.
- Diferenciar colaboradora de usuario.
- Servicios agrupados por familias.
- Habilitar servicios por grupo.
- Disponibilidad por día con inicio y fin.
- Repetición indefinida / hasta fecha.
- Indicar si puede recibir turnos.

### No se puede hacer sin aprobación

- Reintroducir niveles GLAMB.
- Reintroducir Instagram en colaboradoras como campo obligatorio.
- Eliminar agrupación de servicios.
- Eliminar disponibilidad por día.
- Eliminar la opción de recibir turnos.

---

## 4. Agenda desktop/tablet

### Protegido

- Agenda por profesionales.
- Horarios a la izquierda.
- Turnos como bloques.
- Intervalos 15/30/60.
- Filtro por profesional.
- Filtro por grupo.
- Vista día/lista/semana.
- Mostrar/ocultar bloqueos.
- Línea de ahora.
- Estados de turno.
- Popover de detalle.
- Crear turno.
- Validación de solapamientos.
- Huecos vendibles calculados.

### No se puede hacer sin aprobación

- Volver a una agenda solo de cards.
- Eliminar grilla por horarios.
- Eliminar creación de turnos.
- Eliminar estados.
- Eliminar filtros.
- Eliminar validación de solapamientos.

---

## 5. Agenda móvil

### Protegido

- Vista panorámica para recepción/admin/dueño.
- Horarios a la izquierda.
- Profesionales por columnas.
- Turnos como bloques.
- Bloqueos/no disponible visibles.
- Bottom nav visual.
- Crear nueva cita.
- Crear cita desde hueco.
- Vista lista para colaboradora.

### No se puede hacer sin aprobación

- Convertir agenda móvil solo en lista para todos los roles.
- Copiar literalmente diseño de Fresha.
- Eliminar identidad visual GLAMB.
- Eliminar opción de crear cita.
- Eliminar creación desde hueco.

---

## 6. Ventas & Caja

### Protegido

- Módulo Ventas & Caja, no solo Caja simple.
- Apertura de caja con monto inicial obligatorio.
- Registrar retiro.
- Cierre con efectivo esperado vs contado.
- Origen de venta:
  - Turno en agenda.
  - Cliente existente sin turno.
  - Cliente nuevo.
- Cliente obligatorio.
- Cliente nuevo abre creación de cliente.
- Una o más líneas de servicio.
- Colaboradora por línea.
- Servicio por línea.
- Precio editable.
- Grupo inferido por servicio.
- Seña visible por línea.
- Seña informativa, no descuenta del total visible.
- Propina por línea.
- Adicionales colapsados.
- Pago por línea.
- Pago mixto por línea.
- Guardar para cobrar después.
- Pendientes de cobro.
- Cobrar pendiente inyectándolo al formulario.
- Tickets del día.
- Anular ticket.
- Caja del día.
- Movimientos por medio.

### No se puede hacer sin aprobación

- Volver a registrar solo pagos simples.
- Eliminar tickets.
- Eliminar múltiples servicios por venta.
- Ocultar o eliminar seña.
- Hacer que la seña descuente del total visible sin aprobación.
- Eliminar propina.
- Eliminar pago mixto.
- Eliminar pendientes de cobro.
- Eliminar apertura/cierre de caja.

---

## 7. Centro de Mando

### Protegido

- KPIs principales.
- Caja esperada.
- Turnos del día.
- Alertas.
- Oportunidades de Katy.
- Conexión con Agenda, Clientes, Equipo y Caja.

### No se puede hacer sin aprobación

- Convertirlo en dashboard decorativo sin acciones.
- Eliminar conexión con Caja.
- Eliminar conexión con Agenda.
- Eliminar alertas.

---

# Protocolo si un cambio toca una función protegida

El asistente debe responder:

```txt
Este cambio afecta una funcionalidad protegida:
[funcionalidad]

Riesgo:
[riesgo]

Necesito aprobación explícita antes de modificarla.
¿Aprobás este cambio?
```

No debe ejecutar el cambio hasta recibir aprobación.

---

# Estado

Mapa de funcionalidades protegidas aprobado por el usuario.
