# Prompt de continuación — GLAMB OS

> Actualizado: **03/08/2026**
> Copiá y pegá TODO lo de abajo (desde "Hola, retomamos…") como primer mensaje en la sesión nueva.

---

Hola, retomamos el trabajo en **GLAMB OS**. Sos mi desarrollador de confianza en este proyecto; venimos trabajando hace muchas sesiones. Acá tenés todo el contexto para seguir como si nunca nos hubiéramos cortado.

## Cómo me gusta trabajar (esto es lo más importante)

- **Hablame en español, tono argentino (de "vos"), informal y claro.** Andá al grano — no me des ensayos si no los pido.
- **Verificá SIEMPRE que las cosas funcionen ANTES de decirme que están listas.** No me digas "ya está" si no lo probaste. Si no lo pudiste probar, decímelo con esas palabras.
- **Leé el log del deploy, no el estado del workflow.** El job sale en verde aunque falle. Ya me reportaste un deploy "exitoso" que en realidad había fallado.
- **Sé honesto con las limitaciones.** Si algo no se puede, o tiene un costo, decímelo de una con las opciones reales. Prefiero una respuesta incómoda a humo.
- **Antes de tocar datos en vivo, explicame el plan y confirmá conmigo.** Y corré siempre la simulación antes del `-apply`.
- **No soy programador.** Explicame en criollo, con el impacto real ("esto te hace perder plata", "esto rompe el cobro"), no en jerga.
- Para pasos en consolas externas (Firebase, Google Cloud, Meta), **guiame paso a paso y pedime capturas**; yo te las mando.
- Me gustan las cosas **automáticas** siempre que se pueda.
- **La app está en producción, en uso real todos los días. Los datos NO se pueden perder — ya pasó una vez y no puede volver a pasar.**
- **No dañes nada, no relentices la app, y que no se dispare el gasto de la página.**
- **Nunca incluyas el identificador del modelo (Sonnet/Opus/Fable/etc.) en commits, código, ni nada que se suba al repo — solo en el chat.**
- No crees Pull Requests salvo que te lo pida explícitamente.

## Las ramas (leé esto antes del primer commit)

| | |
|---|---|
| Repo | `danieldiazmendez92-cpu/claude-SuperAppGlamb` |
| **Rama de desarrollo** | `claude/commission-calculation-bug-j29gxr` |
| **Rama de deploy** | `claude/beautiful-fermat-l5mac7` (la única que dispara el despliegue) |

Se trabaja y se commitea en la rama de desarrollo, y para publicar se hace `cherry-pick` del commit a la rama de deploy y se pushea ahí.

```bash
git checkout claude/commission-calculation-bug-j29gxr
# … cambios … commit …
git push -u origin claude/commission-calculation-bug-j29gxr
git checkout claude/beautiful-fermat-l5mac7
git cherry-pick <sha>
git push -u origin claude/beautiful-fermat-l5mac7   # ← dispara el deploy
```

> **Si la sesión nueva te asigna otra rama distinta, avisame y seguí usando estas dos.** No quiero los commits dispersos en cinco ramas.

**Antes de cada deploy:** subir `const CACHE = 'glamb-os-vNN'` en `sw.js`. Versión actual: **`glamb-os-v77`**. Si no se sube, los navegadores siguen sirviendo lo viejo.

## El proyecto

- **App:** GLAMB OS — gestión completa del salón GLAMB Belgrano: agenda, caja, clientas, catálogo, equipo/comisiones, RRHH/liquidaciones, finanzas + contabilidad formal, comunicaciones (email/encuestas/consentimientos) y el asistente Athenas.
- **Archivo principal:** `glamb-os-firebase.html` (~14.430 líneas). PWA de un solo archivo, todo el JS en un IIFE, sin build step.
- **Firebase:** proyecto `glamb-os`, región `southamerica-east1`, plan Blaze. Cuenta de facturación `01A173-3BFAB5-90192E`.
- **Roles:** `admin` (todo) · `medio`/recepción (agenda del día, clientas sin contacto, caja, solo consentimientos en Comunicaciones) · `bajo`/colaboradora (su día, registrar venta, solo consentimientos).
- **Páginas públicas** (sin login, archivos estáticos en la raíz):
  - `consentimiento.html` — consentimientos que firma la clienta (3 plantillas: láser, microblading, PRP)
  - `survey.html` — encuesta de satisfacción
  - `historial-fresha.html` — **archivo histórico de Fresha**: 12.807 citas / 1.324 clientas (03/2024–06/2026), buscador propio. Congelado, no se sincroniza. Link: https://glamb-os.web.app/historial-fresha.html
- **Cloud Functions** (`functions/index.js`, todas `minInstances: 0`):
  - `sendAppointmentReminders` — cada 15 min
  - `sendRetentionEmails` — diaria 11:00 AR, cooldown 90 días, máx 40 por corrida
  - `sendConsentInvite` — manda el link de firma server-side
  - `sendConsentCopy` — copia a la clienta al firmar
- **Herramienta de diagnóstico sobre datos reales:** `tools/finance-recovery/recover.js`. Desde el entorno del agente no hay acceso directo a Firestore ni al sitio; se escribe el modo en `tools/finance-recovery/MODE`, se pushea a la rama de deploy y se lee el resultado en el log del workflow. Modos de lectura y modos de escritura (cada uno con su simulación sin `-apply`) están listados en el `README.md`.

Todo el detalle técnico (arquitectura, dónde vive cada dato, reglas de Firestore, criterios de negocio) está en **`README.md`** del repo, que está actualizado. Leelo antes de tocar código.

## ⚠️ El incidente de pérdida de datos (11-12/07/2026)

Se perdieron 10 gastos y un anticipo de sueldo porque `financePrivate/main` era un documento gigante compartido y un dispositivo con copia vieja lo sobrescribió entero. Se recuperó todo vía PITR (7 días). **La causa raíz está corregida** (colecciones por-registro). Si vuelve a aparecer un "esto no está": mirá los datos reales con `recover.js` antes de asumir pérdida — ya pasó dos veces que el dato estaba perfecto y el problema era la pantalla.

## Lo que se resolvió en la última sesión (agosto 2026)

**Formularios y comunicaciones**
1. Consentimiento de microblading v1.1: política de **72 horas hábiles** para reprogramar/cancelar o se consume la seña, + cuidados previos (24-48 h, 1-2 semanas, 1 mes, el día del turno).
2. **Nuevo consentimiento de PRP** (6 secciones, bloque capilar condicional).
3. **Exportar consentimiento firmado a PDF** desde la app, para compartir o imprimir.
4. **Mails de reactivación que se repetían todos los días**: corrían en el navegador de cada dispositivo con la app abierta. Se sacaron del navegador y se pasaron a la Cloud Function `sendRetentionEmails` con guardián anti-repetición (90 días).

**Caja, fechas y cobros**
5. **Bug sistémico de fechas**: el día de un movimiento se calculaba en UTC, así que lo registrado después de las 21:00 AR aparecía al día siguiente. Se creó el helper `dayOf(iso)` y se corrigieron 27 lugares, incluidos los períodos de comisión. Había 24 pagos afectados.
6. **Sesión de caja que retrocedía de día** por un dispositivo con datos viejos: guardián transaccional que rechaza una sesión más vieja que la remota.
7. **Retiro huérfano** que no se contaba en el efectivo esperado — corregido en los datos y en el código.
8. **El precio escrito a mano en el turno ahora manda** sobre el del catálogo (antes se ignoraba y se cobraba mal).
9. **Turnos que figuraban pagados sin cobro registrado** (retención por inasistencia): al sacar el turno de "no vino" ahora ofrece anular el ticket de retención.
10. **Tickets de caja con el detalle discriminado**: cada ítem con su nombre y su valor (servicio + exclusividad + adicionales), más un resumen. Se filtraron los pagos con seña aplicada para que no dupliquen.
11. **Señas comprometidas**: una seña dejada para un turno futuro ya no se consume sola al cobrar otro turno. La app precarga solo el saldo *libre* y avisa lo que está reservado.
12. Gasto de sueldo de Glevetis que faltaba — recuperado.

**Otros**
13. Auditoría de qué cobra Google Cloud.
14. `historial-fresha.html` — el histórico de Fresha, buscable, accesible también para Eze.
15. `README.md` reescrito de cero (el anterior era de julio y describía un prototipo en localStorage).

## Pendientes / ideas no ejecutadas

- **Anular un retiro deja rastro**: hoy se borra del array (`.filter(x=>x.id!==id)`) y no queda registro. Convendría marcarlo como anulado en vez de borrarlo.
- **Renombrar el botón "✓ Pagado"** en la tarjeta del turno: significa "seña paga" y confunde al lado de "✓ Ya cobrado".
- **Revisión de salud automática**: un chequeo proactivo de consistencia de datos que avise antes de que yo encuentre el error a mano.
- **Política de limpieza en Artifact Registry** (0,78 GB acumulados, sin política).
- **2.623 `clientsPrivate` contra 1.384 `clients`** — hay registros privados huérfanos para revisar.
- **Que el workflow de deploy muestre los errores de Functions** en vez de taparlos con `continue-on-error: true`.
- **WhatsApp Business API** para recordatorios: decisiones tomadas, falta que yo cree la app en Meta y genere el token.
- Manuales en `docs/` — podrían necesitar actualización.

## Datos útiles

- Remitente del sistema: **glambbelgrano@gmail.com** · Mi email: danieldiazmendez92@gmail.com
- Cola de emails: colección `mail` (extensión Trigger Email). Dedup: `sentReminders`.
- PITR de Firestore activo, 7 días. Backup JSON manual desde el módulo Clientes.

Arrancá preguntándome en qué querés trabajar hoy.
