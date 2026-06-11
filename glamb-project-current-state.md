# GLAMB OS — Estado actual del proyecto

## Para continuar en una conversación nueva

Usar este documento como contexto principal.

Instrucción sugerida para el nuevo chat:

```txt
Continuemos el proyecto GLAMB OS. Usá como contexto el archivo glamb-project-current-state.md. El archivo estable es glamb-os-stable.html y los cambios se hacen primero en glamb-os-working.html. Respetá glamb-change-control.md, glamb-protected-features.md y glamb-qa-checklist.md.
```

---

## Estado actual

GLAMB OS es una app interna para operar GLAMB como cerebro operativo del salón.

Actualmente estamos en etapa de prototipo HTML funcional. Todavía no se sube a Firebase Studio.

## Archivos vivos principales

### Estable

`glamb-os-stable.html`

Última versión aprobada. No modificar directamente.

### Trabajo

`glamb-os-working.html`

Archivo donde deben hacerse los próximos cambios.

### Resultado final / alias de revisión

- `glamb-os-resultado-final.html`
- `glamb-os-app-actualizada.html`

Ambos están sincronizados con el estable actual.

---

## Reglas de trabajo vigentes

Documentos vivos:

- `glamb-change-control.md`
- `glamb-protected-features.md`
- `glamb-qa-checklist.md`

Regla principal:

> Todo cambio se hace primero en `glamb-os-working.html`. Solo se integra a `glamb-os-stable.html` con aprobación explícita del usuario.

Antes de ejecutar cambios, el asistente debe informar:

```txt
Tipo de cambio:
Módulos afectados:
Funciones protegidas involucradas:
Riesgos:
Archivo de trabajo:
¿Requiere aprobación explícita?: Sí/No
```

---

## Agentes conceptuales activos

### GLAMB Visual Director

Archivo:

`glamb-visual-agent.md`

Responsable de estética, diseño, consistencia visual, sensación premium y evitar apariencia administrativa.

### GLAMB Functional Auditor

Archivo:

`glamb-functional-audit-agent.md`

Responsable de auditar funcionalidad, flujos, riesgos, dependencias y preparación MVP.

Regla nueva:

> Todo cambio funcional debe pasar por revisión tipo QA del auditor antes de entregarse.

---

## Funcionalidades protegidas clave

Ver detalle completo en:

`glamb-protected-features.md`

Protegidas especialmente:

- Navegación entre módulos.
- Crear cliente.
- WhatsApp como dato principal del cliente.
- Email opcional del cliente.
- Código único de cliente.
- Crear turno.
- Cliente desde Agenda con buscador/autocomplete.
- Alta rápida de cliente desde Agenda.
- Turno con múltiples servicios.
- Un bloque de agenda por servicio/profesional.
- Seña en turno.
- Medio de seña con Transferencia por defecto.
- Seña como anticipo aplicado en venta.
- Agenda por horarios y profesionales.
- Zoom de columnas.
- Columna horaria fija.
- Ventas & Caja tipo GLAMB Ledger.
- Apertura/cierre de caja.
- Pendientes de cobro.
- Tickets del día.

---

# Módulos actuales

## 1. Centro de Mando

Muestra KPIs, agenda, caja esperada, alertas y oportunidades.

## 2. Clientes / CRM

Estado actual:

- Crear cliente.
- Sin Instagram.
- Email opcional.
- WhatsApp.
- Código único automático.
- Nota clave.
- Preferencias.
- Perfil de cliente.
- Crear turno desde cliente.

## 3. Equipo & Accesos

Estado actual:

- Crear colaboradora.
- Servicios agrupados por familias.
- Disponibilidad por día.
- Recibe turnos sí/no.
- Sin niveles GLAMB.
- Sin Instagram como campo de colaboradora.

## 4. Agenda desktop/tablet

Estado actual:

- Grilla por profesionales.
- Horarios a la izquierda.
- Turnos como bloques.
- Filtros por profesional y grupo.
- Intervalos 15/30/60.
- Zoom de columnas con pasos 100, 120, 140, 160, 190px.
- Columna de horas fija al desplazarse horizontalmente.
- Línea de ahora.
- Crear turno.
- Crear turno desde hueco.
- Buscador de cliente desde nuevo turno.
- Alta rápida de cliente desde nuevo turno.
- Turno con múltiples servicios.
- Cada servicio genera un bloque por profesional.
- Detalle de turno combinado.
- Seña en turno.
- Medio de seña por defecto Transferencia.

## 5. Agenda móvil

Archivo vivo de referencia visual:

`glamb-mobile-agenda-glamb-style.html`

Estado actual:

- Vista panorámica móvil con identidad GLAMB.
- Horarios a la izquierda.
- Profesionales por columnas.
- Turnos como bloques.
- Bloqueos/no disponible.
- Crear nueva cita.
- Crear cita tocando un hueco.

## 6. Ventas & Caja

Basado en flujo real de GLAMB Ledger.

Estado actual:

- Apertura de caja con monto inicial obligatorio.
- Registrar retiro.
- Cierre con efectivo esperado vs contado.
- Origen de venta:
  - Turno en agenda.
  - Cliente existente sin turno.
  - Cliente nuevo.
- Cliente obligatorio.
- Múltiples líneas de servicio.
- Colaboradora por línea.
- Servicio por línea.
- Precio editable.
- Adicionales.
- Propina.
- Pago por línea.
- Pago mixto.
- Guardar para cobrar después.
- Pendientes.
- Tickets del día.
- Modo Admin caja / Colaboradora.
- Colaboradoras pueden completar ventas.
- Anulación con motivo.
- Referencia de pago.

## 7. Seña / anticipo

Lógica aprobada e integrada:

- La seña se toma al reservar turno.
- La seña es anticipo / pasivo.
- Al registrar la venta, se aplica como anticipo.
- La venta reconoce el total del servicio.
- El saldo a cobrar hoy es total venta menos anticipo aplicado.
- Se registra movimiento `deposit_applied` para trazabilidad.

---

## Últimos cambios integrados al estable

- Zoom de columnas de Agenda.
- Columna horaria fija.
- Cliente sin Instagram + email opcional + código automático.
- Nuevo turno con buscador de cliente.
- Alta rápida de cliente desde Agenda.
- Múltiples servicios por turno.
- Un bloque por servicio/profesional.
- Detalle de turno combinado.
- Seña en turno y precarga como anticipo aplicado en venta.

---

## Próximas recomendaciones

1. No agregar funciones nuevas sin correr QA.
2. Revisar Ventas & Caja con casos reales:
   - turno con seña,
   - pago restante,
   - dos servicios,
   - dos profesionales,
   - pendiente,
   - cobro de pendiente,
   - apertura/cierre.
3. Seguir modularizando mentalmente antes de pasar a Firebase Studio.
4. En futura implementación real, separar componentes y módulos en vez de un HTML único.

---

## Archivos históricos

Hay muchos archivos de versiones anteriores. No usarlos como fuente principal salvo para comparar.

Fuente principal actual:

```txt
glamb-os-stable.html
glamb-os-working.html
glamb-project-current-state.md
README.md
glamb-change-control.md
glamb-protected-features.md
glamb-qa-checklist.md
```
