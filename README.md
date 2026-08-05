# GLAMB OS

Sistema operativo interno de **GLAMB Belgrano** (salón de belleza, Buenos Aires): agenda, caja, clientas, catálogo, equipo, RRHH, finanzas, comunicaciones y consentimientos.

**Está en producción y en uso real todos los días.** No es un prototipo. Los datos son reales y no se pueden perder — ya hubo un incidente (ver más abajo).

---

## Lo mínimo que hay que saber antes de tocar nada

| | |
|---|---|
| Archivo principal | `glamb-os-firebase.html` (~14.700 líneas, PWA de un solo archivo) |
| Rama de trabajo y deploy | `claude/beautiful-fermat-l5mac7` (**la única que dispara el despliegue**) |
| Proyecto Firebase | `glamb-os` · región `southamerica-east1` · plan Blaze |
| Service Worker | `sw.js` — versión actual `glamb-os-v81` |
| Cuenta de facturación | `01A173-3BFAB5-90192E` |

### Ramas: se trabaja directo sobre la de deploy

Desde agosto de 2026 Daniel pidió trabajar **directo en `claude/beautiful-fermat-l5mac7`**, sin rama de desarrollo intermedia:

```bash
git checkout claude/beautiful-fermat-l5mac7
# … cambios … commit …
git push -u origin claude/beautiful-fermat-l5mac7   # ← esto publica en producción
```

**Cada push publica en producción.** No hay red de contención: avisale a Daniel y esperá su ok antes de pushear, salvo que ya te lo haya autorizado para ese cambio.

> `claude/commission-calculation-bug-j29gxr` sigue existiendo en el remoto y era la vieja rama de desarrollo del flujo de dos ramas (se commiteaba ahí y se hacía `cherry-pick` a deploy). Quedó desactualizada: no tiene los commits de agosto de 2026. **No la uses sin preguntarle a Daniel primero.** Ojo con `git branch -a`: no lista lo que el clon no trajo. Para ver qué ramas existen de verdad, `git ls-remote --heads origin`.

> **Si una sesión nueva asigna otra rama, avisale a Daniel y seguí usando la de deploy.** No dispersar commits.

### Antes de cada deploy: subir la versión del Service Worker

`sw.js` tiene `const CACHE = 'glamb-os-vNN'`. **Si no se incrementa, los navegadores siguen sirviendo la versión vieja.** Subir `vNN` → `vNN+1` en cada cambio del HTML.

### Verificar el deploy leyendo el LOG, no el estado

El workflow tiene `continue-on-error: true` en los pasos de Rules y Functions. **GitHub marca el job en verde aunque esos pasos fallen.** Hay que abrir el log y confirmar que dice `✔ Deploy complete!` sin líneas `Error:`. Ya pasó de reportar un deploy exitoso que en realidad había fallado.

---

## Arquitectura

Un solo archivo HTML con CSS y JS embebidos. Sin framework, sin build step. Todo el JS vive en un único IIFE.

**Reglas no negociables:**

1. Todo handler nuevo usa `data-action` + `ACTION_MAP`. **Nunca `onclick=` inline** — las funciones no son globales, no funcionaría.
2. Todo JS dentro del IIFE existente. Sin funciones globales sueltas.
3. Las mutaciones de estado pasan por las funciones centralizadas (`addPayment`, `addAppointment`, `addClient`, `addExpense`…).
4. Los commits terminan con el trailer `Co-Authored-By`. **Nunca** incluir el identificador del modelo (Sonnet/Opus/etc.) en commits, código ni nada que vaya al repo.

### Dónde vive cada dato

El principio: **lo que se escribe seguido y de a un registro por vez va a una colección propia.** Solo cosas chicas y de baja escritura comparten documento.

| Ubicación | Contenido |
|---|---|
| Colecciones por-registro (`SYNCED_COLLECTIONS`) | `clients`, `collaborators`, `appointments`, `payments`, `salesTickets`, `pendingCharges`, `blockers`, `cashClosings`, `financeExpenses`, `financeDeductions`, `financeLiquidations` |
| `clientsPrivate/{id}` | Teléfono y email de clientas — **solo admin lee** |
| `financePrivate/main` | `taxRecords`, `budgets`, `expenseCategories`, `accounting` — solo admin |
| `appState/catalog` | Catálogo de servicios (documento propio, anti-pisado) |
| `appState/config` | `comms`, `athenas`, `reviews`, `cashSession`, `withdrawalReasons`… (`CONFIG_KEYS`) |
| `appState/main` | El resto de `PERSIST_KEYS` (cosas chicas) |
| `consentForms` | Consentimientos informados (creación por el salón, firma pública por token) |
| `surveyResponses` | Respuestas de la encuesta de satisfacción |
| `mail` / `sentReminders` | Cola de emails (extensión Trigger Email) y deduplicación de envíos |
| `localStorage` | Config de Athenas (API keys) + copia local del estado |

`saveState()` guarda en localStorage + nube (debounce 800 ms, intervalo 5 s, flush al cerrar la pestaña).

---

## Roles y permisos

| | 🟢 admin | 🟡 medio (recepción) | 🔴 bajo (colaboradora) |
|---|---|---|---|
| Agenda | Todos los días | Solo día actual | Solo día actual |
| Clientas | Completo, con contacto | Sin email/teléfono | Sin módulo |
| Caja | Completo | Todos los registros | Solo registrar venta |
| Finanzas / RRHH / Catálogo / Equipo | Completo | — | — |
| Comunicaciones | Todas las pestañas | Solo Consentimientos | Solo Consentimientos |

`PERMISSIONS[rol]` define páginas, alcance y la clave `commsTabs`. Las colaboradoras y recepción **solo ven los consentimientos que ellas mismas enviaron** (aislamiento por `createdByUid` en las reglas de Firestore).

---

## Páginas públicas (sin login)

Se sirven como archivos estáticos desde la raíz. El `rewrite **` de `firebase.json` solo aplica cuando no hay archivo que coincida.

| Página | Para qué |
|---|---|
| `consentimiento.html` | Consentimiento informado que la clienta firma desde el celular (token en el link). 3 plantillas: láser, microblading, PRP |
| `survey.html` | Encuesta de satisfacción |
| `historial-fresha.html` | Buscador del historial de citas de Fresha (12.807 citas, 1.324 clientas, 03/2024–06/2026). Archivo histórico congelado, no se sincroniza |

---

## Cloud Functions

Región `southamerica-east1`, todas con `minInstances: 0` (no cobran en reposo).

| Función | Disparador | Qué hace |
|---|---|---|
| `sendAppointmentReminders` | Cada 15 min | Recordatorio de turno por email |
| `sendRetentionEmails` | Diario 11:00 AR | Reactivación de clientas inactivas |
| `sendConsentInvite` | Alta en `consentForms` | Manda el link de firma (server-side, así los roles bajos nunca ven el email de la clienta) |
| `sendConsentCopy` | Firma del consentimiento | Envía copia a la clienta |

> Los envíos automáticos **no corren más en el navegador**. Corrían en cada dispositivo con la app abierta y la misma clienta llegó a recibir 6 mails en dos minutos.

---

## Herramienta de diagnóstico sobre datos reales

Desde este entorno no hay acceso directo a Firestore ni al sitio publicado (el proxy los bloquea). Para leer o corregir datos de producción se usa:

**`tools/finance-recovery/recover.js`** + `.github/workflows/finance-recovery.yml`

Se dispara escribiendo el modo en `tools/finance-recovery/MODE` y pusheando a la rama de deploy. El resultado se lee en el log del workflow.

**Modos de solo lectura:** `inspect`, `diagnose`, `inspect-caja`, `audit-caja`, `audit-retiros`, `audit-fechas`, `inspect-commissions`, `simulate-commissions`, `inspect-liq-finance`, `inspect-reportes`, `inspect-retention`, `inspect-senas`, `inspect-turno`, `inspect-billing`

**Modos que escriben** (siempre tienen su par de simulación sin `-apply`): `restore-collections`, `restore-caja`, `fix-liq-expenses`, `fix-caja-openedat`, `fix-retiro-huerfano`, `seed-retention-guards`, `anular-ticket`

> Regla: **correr siempre la simulación primero**, leer el resultado, y recién ahí el `-apply`. Después dejar `MODE` en un modo de solo lectura.

---

## ⚠️ Incidente de pérdida de datos (11-12/07/2026)

Se perdieron 10 gastos de Finanzas y un anticipo de sueldo porque `financePrivate/main` era **un solo documento gigante compartido**: un dispositivo con una copia vieja sobrescribió el documento entero. Se recuperó todo vía PITR (7 días de retención).

**La causa raíz está corregida** (colecciones por-registro). Si vuelve a aparecer un "esto no está":

1. Fijarse si el módulo todavía guarda en un blob compartido (`PERSIST_KEYS`, `CONFIG_KEYS`).
2. **Antes de asumir pérdida, mirar los datos reales** con `recover.js`. Ya pasó dos veces que el dato estaba perfecto y el problema era la pantalla.

Protecciones vigentes: PITR 7 días · backup JSON manual desde Clientes · guardián que impide que la sesión de caja retroceda a un día anterior.

---

## Criterios de negocio que ya están decididos

- **La seña es un pasivo al recibirse, no un ingreso.** Se reconoce como venta cuando se aplica a un ticket o se retiene por inasistencia.
- **La seña retenida por inasistencia NO paga comisión.** Es ingreso del local por un servicio que no se prestó: la colaboradora no trabajó esa hora. La línea se marca con `noCommission`; `lineEarnsCommission(ticket,línea)` decide, y reconoce por `origin:'no_show'` las inasistencias anteriores a la regla.
- **La propina es de la colaboradora**, no facturación del local. Se excluye de "ventas".
- **Una seña dejada para un turno futuro no se consume sola** en el cobro de otro turno. El sistema precarga solo el saldo *libre* y avisa lo que está reservado.
- **El precio escrito a mano en el turno manda** sobre el del catálogo.
- **El día de un movimiento se calcula en hora argentina**, no en UTC. `createdAt` se guarda en UTC: usar siempre el helper `dayOf(iso)`, nunca `createdAt.slice(0,10)`.
- **Descuentos en Caja:** `canje` (cobra $0, comisión sobre precio de lista), `employee` (no entra plata, se descuenta del sueldo), `client` (bonificación, comisión sobre precio final).
- **Reenvío de mail al editar un turno:** solo si cambia fecha u horario.
- **El costo de nómina es el BRUTO liquidado, contado una sola vez.** Lo que se le descuenta a la colaboradora (anticipo ya entregado, servicio de empleada) sigue siendo costo del salón: cambia la forma de pago, no el costo. Como al pagar una liquidación se genera un gasto en Finanzas y los anticipos generan el suyo al entregarse, `payrollExpenseIds()` los excluye de los gastos para que la nómina no se cuente dos veces. **Si tocás esto, no sumes el bruto sin excluir esos gastos.**
- **Un anticipo es un crédito contra la colaboradora, no un gasto.** Se cancela al descontarse del sueldo. En Libros va a "Créditos a empleadas".
- **Un saldo pendiente se marca cobrado recién cuando la venta existe** (`registerSale`), nunca al cargarlo en el formulario.
- **Para decidir qué servicio empujar se mira la GANANCIA, no la facturación.** `finMarginByGroup` descuenta la comisión, que varía por grupo: dos servicios pueden facturar lo mismo y dejar muy distinto. Un canje da margen negativo — es correcto, cuesta plata.
- **El desglose por servicio/colaboradora descuenta el saldo impago a prorrata** de cada línea, para que sume exactamente los ingresos del período.

---

## Finanzas — cómo está armado

Cinco pestañas: **CFO** (tablero mensual), **Contador** (gastos y presupuesto), **Analista** (análisis por período), **Libros** (contabilidad formal) y **Reportes** (exportables).

Funciones que concentran los criterios. Si cambiás una, revisá las demás — comparten base:

| Función | Qué resuelve |
|---|---|
| `finTicketRevenue(t)` | Ingreso reconocido de un ticket: servicios menos el saldo impago (ese se devenga al cobrarse, como ticket nuevo) |
| `finTicketLines(from,to)` | Líneas del período con el saldo impago ya prorrateado. **Base de todos los desgloses** |
| `finExpenses` / `payrollExpenseIds` | Gastos del período, excluyendo los que ya son nómina |
| `finPayrollCost` / `liqGross` | Costo laboral = bruto liquidado (con fallback para liquidaciones viejas sin `grossPay`) |
| `finPayrollSplit` | Separa comisiones (variable) de presentismo/viático (fijo), para el punto de equilibrio |
| `finBreakEven(from,to)` | Punto de equilibrio del período pedido, incluyendo gastos de Caja |
| `finMarginByGroup` / `ByCollaborator` | Ganancia = facturado − comisión |
| `finUnitsByGroup` | Cuántas veces se vendió cada servicio (unidades, no plata) |
| `lineEarnsCommission(t,l)` | Si una línea paga comisión (la seña de inasistencia no) |

### Contabilidad formal (pestaña Libros)

Los asientos **se derivan** de lo que el salón ya registra (tickets, señas, propinas, pendientes, gastos, retiros, liquidaciones) desde el asiento de apertura. No se cargan a mano ni se almacenan: solo se guardan la apertura y los ajustes manuales.

- **`accDay(fecha)` — usarla siempre.** Convierte los timestamps UTC a día argentino, pero deja intactas las fechas que ya vienen como `YYYY-MM-DD`. Pasar esas por `dayOf` las corre **un día para atrás**.
- **`_accE` fuerza a que todo asiento balancee**: la diferencia va a la cuenta puente "Diferencias de registro" para que quede visible en vez de romper el balance.
- **Por eso `Activo = Pasivo + Patrimonio` es una identidad matemática y no prueba nada.** Los controles que sí pueden fallar están en `accControlesHtml()`: diferencias de registro, caja contable contra el arqueo del último cierre (comparada al día del arqueo) y señas aplicadas sin registro de ingreso. **Si agregás un control, que pueda dar rojo** — un chequeo que siempre da verde es peor que ninguno.

---

## Archivos del repositorio

| Archivo | Descripción |
|---|---|
| `glamb-os-firebase.html` | La app |
| `consentimiento.html` · `survey.html` · `historial-fresha.html` | Páginas públicas |
| `sw.js` · `manifest.json` | PWA |
| `functions/index.js` | Cloud Functions |
| `firestore.rules` | Reglas de seguridad |
| `firebase.json` · `.firebaserc` | Config de deploy |
| `tools/finance-recovery/` | Diagnóstico y corrección sobre datos reales |
| `.claude/agents/contador-glamb.md` | Agente auditor: estudio contable especializado en pequeños negocios y rubro belleza. Se invoca por nombre para auditar Finanzas |
| `docs/` | Manuales de recepción y colaboradora, presentación de bienvenida |
| `CONTINUAR-SESION.md` | Contexto para retomar en una sesión nueva |
| `MIGRATION.md` | Histórico de la migración a Firebase |
| `glamb-os-working-v6.html` | Prototipo viejo en localStorage (respaldo, no se despliega) |
