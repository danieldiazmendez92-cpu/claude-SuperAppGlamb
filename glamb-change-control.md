# GLAMB OS — Control de cambios

## Estado aprobado

A partir de ahora el proyecto se trabaja con un archivo estable y copias de trabajo.

## Archivo estable

El archivo estable actual es:

`glamb-os-stable.html`

Este archivo representa la última versión aprobada del prototipo.

## Regla principal

`glamb-os-stable.html` no debe modificarse directamente.

Solo se actualiza cuando:

1. Se crea un cambio en un archivo de trabajo.
2. Se prueba el cambio.
3. Pasa checklist funcional.
4. Si corresponde, pasa revisión visual.
5. El usuario aprueba explícitamente la integración.

---

## Archivo de trabajo

El archivo de trabajo base es:

`glamb-os-working.html`

Los cambios nuevos deben hacerse primero ahí o en archivos experimentales.

Ejemplos:

- `glamb-os-working.html`
- `glamb-agenda-working.html`
- `glamb-caja-working.html`
- `glamb-mobile-working.html`

---

## Tipos de cambio

Antes de tocar archivos, cada cambio debe clasificarse.

### 1. Cambio visual

Afecta:

- CSS.
- Layout.
- Jerarquía visual.
- Tipografía.
- Colores.
- Espaciados.

Regla:

> No debe tocar lógica JavaScript salvo autorización explícita.

### 2. Cambio funcional

Afecta:

- JavaScript.
- Estado.
- Renderizado dinámico.
- Formularios.
- Validaciones.
- Flujos.

Regla:

> Debe pasar auditoría funcional antes de integrarse.

### 3. Cambio de texto

Afecta:

- Labels.
- Microcopy.
- Nombres visibles.
- Mensajes.

Regla:

> No debe modificar estructura ni lógica.

### 4. Cambio estructural

Afecta:

- Módulos.
- Navegación.
- Arquitectura del prototipo.
- Relación entre pantallas.

Regla:

> Requiere aprobación explícita del usuario antes de ejecutarse.

---

## Flujo obligatorio de trabajo

```txt
1. Definir cambio.
2. Clasificar tipo de cambio.
3. Identificar módulos afectados.
4. Revisar mapa de funcionalidades protegidas.
5. Si toca función protegida, pedir aprobación explícita.
6. Trabajar sobre copia, no sobre stable.
7. Ejecutar checklist.
8. Auditar funcionalmente si corresponde.
9. Auditar visualmente si corresponde.
10. Pedir aprobación para integrar.
11. Recién ahí actualizar glamb-os-stable.html.
```

---

## Frase obligatoria antes de ejecutar cambios

Antes de implementar un cambio, el asistente debe informar:

```txt
Tipo de cambio:
Módulos afectados:
Funciones protegidas involucradas:
Riesgos:
Archivo de trabajo:
¿Requiere aprobación explícita?: Sí/No
```

---

## Criterio de integración a stable

Un cambio solo puede pasar a `glamb-os-stable.html` si:

- No rompe navegación.
- No rompe creación de cliente.
- No rompe agenda.
- No rompe ventas/caja.
- No rompe equipo.
- No rompe mobile si el cambio afecta mobile.
- El usuario lo aprueba.

---

## Agentes involucrados

### GLAMB Functional Auditor

Debe revisar cambios funcionales, flujos, dependencias y riesgos.

### GLAMB Visual Director

Debe revisar cambios visuales, estética premium y consistencia.

---

## Decisión aprobada

Este sistema de trabajo fue aprobado por el usuario y queda vigente para el resto del proyecto.
