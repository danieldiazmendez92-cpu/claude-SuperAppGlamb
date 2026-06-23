# Migración a Firebase — Guía paso a paso

Archivo de la app: **`glamb-os-firebase.html`** (el prototipo `glamb-os-working-v6.html` queda intacto como respaldo).

> ⚠️ La versión Firebase **no funciona abriéndola como archivo** (`file:///...`). Necesita servirse desde `localhost` o desde Hosting. Abajo están las dos opciones.

---

## 0. Una sola vez: publicar las reglas de seguridad

Sin esto, Firestore **deniega todo** (elegiste modo producción) y la app no carga datos.

**Opción fácil (sin instalar nada):**
1. Consola de Firebase → **Build → Firestore Database → pestaña "Reglas"**.
2. Borrá lo que haya y pegá **todo el contenido de `firestore.rules`** (está en este repo).
3. **Publicar**.

---

## 1. Crear tu cuenta de administrador (una vez)

1. Consola → **Build → Authentication → pestaña "Users" → "Agregar usuario"**.
2. Poné tu email y una contraseña → crear.
3. Copiá el **UID** que aparece en la fila del usuario (un código largo).
4. Andá a **Firestore Database → "Iniciar colección"** → ID de colección: `users`.
5. ID del documento: **pegá el UID** del paso 3. Agregá estos campos:
   - `name` (string): `Daniel`
   - `role` (string): `admin`
6. Guardar.

Repetí 1–6 para Eze (con `role: admin`). Las recepciones/colaboradoras las vas a poder crear **desde la app** en la próxima fase; por ahora, si querés probar esos roles, crealos igual acá con `role: medio` o `role: bajo`.

---

## 2A. Probar YA en tu compu (rápido, recomendado para empezar)

Necesitás Node instalado (ya usaste `npm`, así que lo tenés).

1. Abrí una terminal en la carpeta del proyecto.
2. Ejecutá:
   ```
   npx serve .
   ```
3. Te va a dar una dirección tipo `http://localhost:3000`.
4. Abrí en el navegador: **`http://localhost:3000/glamb-os-firebase.html`**
5. Iniciá sesión con el email y contraseña del paso 1.

`localhost` ya está autorizado en Firebase Auth por defecto, así que funciona sin configurar nada más.

---

## 2B. Publicar online (URL pública, para usar desde el celular/salón)

1. Instalar Firebase CLI (una vez):
   ```
   npm install -g firebase-tools
   ```
2. Iniciar sesión (abre el navegador):
   ```
   firebase login
   ```
3. Desde la carpeta del proyecto, desplegar:
   ```
   firebase deploy
   ```
   Esto sube las reglas de Firestore **y** el sitio (Hosting).
4. Te va a dar una URL: **`https://glamb-os.web.app`** → entrá ahí e iniciá sesión.

> El `firebase.json` ya está configurado para servir `glamb-os-firebase.html` como página principal e ignorar los archivos del prototipo viejo.

---

## Qué funciona en esta fase (A)

- ✅ Login real con email + contraseña (Firebase Auth)
- ✅ Datos en la nube (Firestore), compartidos entre dispositivos y en vivo
- ✅ Roles (admin / medio / bajo) leídos desde la colección `users`
- ✅ El gateo por rol de la interfaz (menús, agenda solo-hoy, caja, enmascarado)

## Qué falta (próximas fases)

- **Fase A.2:** crear y dar de baja usuarios **desde la propia app** (módulo Equipo & Accesos), sin tocar la consola.
- **Fase B:** protección de datos a nivel de servidor — que un rol bajo/medio **no pueda descargar** teléfonos ni finanzas ni aunque entre a la base directo. Hoy el enmascarado sigue siendo de interfaz.
- **Concurrencia:** el estado se guarda como un documento único; si dos personas editan exactamente al mismo tiempo, el último en guardar pisa al anterior. Se resuelve en Fase B separando los datos por colección.

## Notas

- La `apiKey` del proyecto es pública por diseño (se protege con las reglas y los dominios autorizados), por eso puede vivir en el código.
- Si agregás un dominio propio, sumalo en **Authentication → Settings → Dominios autorizados**.
