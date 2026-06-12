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
| Último commit | `b673413` |
| Publicación futura | Firebase Studio (después de estabilizar flujos) |

---

## Arquitectura

Single-file HTML (~5200 líneas) con CSS y JS embebidos. Sin framework, sin build step. Estado persistido en `localStorage`.

---

## Módulos

| Módulo | Estado |
|--------|--------|
| Centro de Mando | ✅ KPIs + alertas Katy |
| Clientes / CRM | ✅ Perfil, historial, preferencias |
| Equipo & Accesos | ✅ Colaboradoras + disponibilidad |
| Catálogo | ✅ Grupos → Servicios → Variantes + Adicionales |
| Agenda desktop | ✅ Grilla por profesional, drag & drop, combinados |
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

## Reglas de trabajo

1. **Todo cambio va a `glamb-os-working-v6.html`**
2. `glamb-os-stable.html` no se modifica sin aprobación explícita
3. Ver `glamb-project-current-state.md` para contexto completo y bugs conocidos
4. Los commits aparecen como "Unverified" en GitHub — el entorno no tiene GPG, es normal

---

## Archivos del repositorio

| Archivo | Descripción |
|---------|-------------|
| `glamb-os-working-v6.html` | **Archivo de trabajo activo** |
| `glamb-os-stable.html` | Copia inicial estable |
| `glamb-mobile-agenda-glamb-style.html` | Agenda móvil (referencia visual) |
| `glamb-project-current-state.md` | Estado detallado del proyecto |
| `glamb-change-control.md` | Reglas de control de cambios |
| `glamb-protected-features.md` | Funcionalidades protegidas |
| `glamb-qa-checklist.md` | Checklist de QA |
| `glamb-visual-agent.md` | Guía de identidad visual |
| `glamb-functional-audit-agent.md` | Guía de auditoría funcional |
