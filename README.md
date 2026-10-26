# UTM Desk NoSQL Cloud

Sistema de registro, atención y analítica de incidencias del campus, con API REST en Node.js, base de datos documental MongoDB y almacenamiento de evidencias en Supabase Storage.

Esta documentación describe el código tal como está en el repositorio. Cada sección indica si el comportamiento ya fue verificado localmente o si todavía requiere evidencia externa (Atlas, Supabase o Postman).

## 1. Descripción

UTM Desk centraliza los reportes del campus en tickets con folio, ubicación, prioridad, evidencias fotográficas y bitácora de seguimiento. La aplicación permite registrar la incidencia, autorizar su atención, asignarla a un técnico, registrar intervenciones con horas, adjuntar evidencia, cerrarla y consultar indicadores de desempeño.

Tres categorías, con campos estructurados propios (`server/index.js`, `CAMPOS_CATEGORIA`):

| Categoría | Campos obligatorios | Campos opcionales |
|---|---|---|
| Cómputo y telecomunicaciones | `tipo_equipo`, `equipos_afectados` | `direccion_ip`, `vlan` (entero 1-4094, IPv4 validada) |
| Infraestructura física y mantenimiento | `tipo_infraestructura`, `area_afectada` | `riesgo_estructural`, `requiere_tercero` |
| Sistemas y servicios académicos | `sistema_afectado`, `tipo_falla` | `usuarios_afectados`, `modulo` |

Enviar `datosCategoria` sin los obligatorios devuelve **400** con la lista de campos faltantes; no se acepta un campo de texto libre genérico.

## 2. Roles y permisos

Cuatro roles (`ROLES`), cada uno con una vista distinta en el cliente:

| Rol | Puede |
|---|---|
| `reportante` | Crear incidencias propias, consultar su detalle, adjuntar evidencia, etiquetar, consultar la base de conocimiento |
| `tecnico` | Ver solo las incidencias asignadas, cambiar estado dentro de lo permitido, registrar intervenciones con horas, redactar artículos |
| `soporte_ti` | Todo lo anterior más: autorizar/rechazar, asignar técnico, cambiar prioridad, gestionar usuarios, exportar, borrar artículos |
| `directivo` | Solo indicadores (`/stats`): no lee expedientes ni exporta |

Cómo se aplica la autorización en el servidor:

- `auth(...roles)` descifra el JWT y **vuelve a leer el rol desde la base** en cada petición, así que un cambio de rol surte efecto aunque el token sea antiguo.
- `scope(user)` restringe `/incidencias`: un técnico recibe solo `tecnico.id = su id`, un reportante solo `reportante.id = su id`, Soporte TI ve todo.
- `puedeVer(user, incidencia)` decide el acceso al detalle y a las evidencias; el directivo devuelve `false` (solo agregados).
- Los permisos se comprueban **antes** de tocar datos: un rol no autorizado recibe 403, no un 404 engañoso ni una escritura parcial.

`bootstrap()` migra roles heredados (`usuario → reportante`, `admin → soporte_ti`) y garantiza que la cuenta de `ADMIN_EMAIL` exista como Soporte TI: la crea si no está, la asciende si su documento todavía trae `admin` y le aplica `ADMIN_PASSWORD` cuando el hash guardado no coincide. Además, la capa de autorización acepta esos valores antiguos como alias (`ROL_ALIAS` en `server/index.js`), así que una cuenta creada como `admin` recupera el panel completo aunque la migración no se haya ejecutado; las respuestas de la API siempre devuelven el rol normalizado. Consecuencia a tener presente: quien pueda editar `server/.env` y reiniciar el servidor restablece la contraseña de esa cuenta. `npm run dev:local` también respeta `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

## 3. Ciclo de vida y autorización (RF-06 / RF-07)

Estados: `Abierta`, `En proceso`, `En espera`, `Resuelta`, `Cerrada`.

Transiciones permitidas (`TRANSICIONES` en `server/index.js`):

| Desde | Hacia |
|---|---|
| Abierta | En proceso, En espera, Cerrada |
| En proceso | En espera, Resuelta |
| En espera | En proceso, Resuelta, Cerrada |
| Resuelta | Cerrada, En proceso |
| Cerrada | (ninguna) |

- `resolver` solo para `tecnico` y `soporte_ti`; `cerrar` solo para `soporte_ti`.
- Una transición no permitida devuelve **400** y no escribe nada.
- Cada incidencia nace con `autorizacion.estado = pendiente`. `PATCH /incidencias/:id/asignar` responde **409** mientras la solicitud no esté aprobada (RF-07).
- `/autorizacion` solo es de Soporte TI; aprobar sin motivo está permitido, **rechazar exige `motivo`** (400 si viene vacío) y el rechazo cierra la incidencia (`estado = Cerrada`, `fechaResolucion` fijada).
- `/auth/me` devuelve `id`, `nombre`, `email` y `rol` para que el cliente reanude la sesión y valide la propiedad de sus incidencias tras recargar.

Toda acción deja entrada en `historial` con autor, rol, comentario y estados anterior/nuevo.

## 4. Modelo de datos

Cuatro colecciones en MongoDB, con los nombres que realmente usa Mongoose:

| Colección | Contenido |
|---|---|
| `incidencias` | Ticket completo: folio, campos comunes, `datosCategoria`, `reportante`, `tecnico`, `evidencias`, `historial`, `autorizacion`, `horasTotales`, `fechaResolucion`, `origen` |
| `users` | `nombre`, `email` único en minúsculas, `password` (`select: false`, bcrypt), `rol`, `ultimoAcceso` y timestamps de registro. `bootstrap()` completa `createdAt` con la fecha que ya trae el `ObjectId` de los perfiles creados antes de activar los timestamps |
| `counters` | Contador `_id: "folio"` que genera folios `UTM-AAAA-NNNN` con `findOneAndUpdate` + `$inc` y `upsert` |
| `articulos` | Base de conocimiento (`titulo`, `contenido`, `autor`, timestamps) |

No existe una colección separada de auditoría: la trazabilidad vive dentro de `incidencias.historial`, que es la decisión de diseño para conservar un solo documento por expediente.

### Índices declarados (`ensureIndexes`)

| Índice | Propósito |
|---|---|
| `{ titulo: 'text', descripcion: 'text' }` pesos 10/3, `default_language: 'spanish'` (`texto_incidencias`) | búsqueda textual en español con `?q=` |
| `{ estado: 1, prioridad: 1, createdAt: -1 }` | listado y orden por novedad |
| `{ 'autorizacion.estado': 1, estado: 1 }` | bandeja de pendientes |
| `{ etiquetas: 1 }`, `{ edificio: 1 }`, `{ 'reportante.id': 1 }`, `{ 'tecnico.id': 1, estado: 1 }` | filtros y alcance por rol |
| `{ folio: 1 }` y `{ email: 1 }` únicos | integridad; duplicado responde 409 |
| `{ fechaResolucion: 1 }` con `expireAfterSeconds: TTL_DIAS*86400` (`ttl_resolucion`) | retención de expedientes cerrados, 60 días por defecto; `TTL_DIAS=0` lo desactiva |

Verificado en la suite local (`server/test/api.test.mjs`, base en memoria). **Pendiente de evidencia:** confirmar los índices y la retención TTL en el clúster de Atlas del equipo.

### Operadores NoSQL en operaciones reales

| Operador | Dónde |
|---|---|
| `$inc` | folio consecutivo al crear; `horasTotales` al registrar una intervención |
| `$set` | estado y `fechaResolucion`, prioridad, técnico asignado, `autorizacion.*`, cambio de rol |
| `$push` | `historial` en cada acción; `evidencias` con `$each` al adjuntar archivos |
| `$addToSet` / `$pull` | `/etiquetas`: agrega sin duplicar y elimina sin reescribir el arreglo completo |

### Pipelines de agregación

`GET /stats` ejecuta nueve pipelines en paralelo: conteo por estado, horas promedio de resolución por edificio (`$subtract`/`$divide`), top 10 de etiquetas (`$unwind` + `$group` + `$sort` + `$limit`), distribución por categoría y prioridad, incidencias por edificio, carga abierta, tendencia mensual (`$year`/`$month`) y totales con `$cond` para pendientes. `GET /incidencias/export` usa `$match` + `$sort` para el documento de control.

## 5. Evidencias: bucket privado y URLs firmadas

- `multer` en memoria: campo **`evidencias`**, máximo **5 archivos** y **15 MB** por archivo, solo JPG, PNG y PDF. Un archivo fuera del filtro devuelve 400; exceder el peso, 413.
- La subida la hace **el servidor** con `SUPABASE_SERVICE_KEY`; la clave nunca llega al navegador.
- Se guarda únicamente la `path` dentro del bucket `evidencias`; la respuesta al cliente no incluye enlaces permanentes.
- Al leer la incidencia, `firmarURL()` pide `createSignedUrl(path, 3600)` y agrega el campo `url`. El bucket permanece privado y el enlace expira en una hora.
- Orden de validaciones en `POST /incidencias/:id/evidencias`: 404 si no existe, 403 si no es tuya (y no eres Soporte TI), **409 si está `Cerrada`**, 400 si ningún archivo pasó el filtro.
- En `npm run dev:local` las evidencias se guardan en un mapa de RAM y se sirven desde `http://localhost:4101` imitando la URL firmada. **Eso no demuestra la integración con Supabase.**

**Pendiente de evidencia:** bucket privado real, subida y expiración de `createSignedUrl` contra Supabase con credenciales del equipo.

## 6. API REST

Base: `http://localhost:4000/api` (producción local) o `http://localhost:4100/api` (`dev:local`). Autenticación: cabecera `Authorization: Bearer <token>`.

| Método y ruta | Roles | Respuestas |
|---|---|---|
| `POST /auth/register` | público | 201 (ignora el rol privilegiado enviado), 400, 409, 429 |
| `POST /auth/login` | público | 200 `{token,user}`, 401 genérico, 429 |
| `GET /auth/me` | cualquiera | 200 con `id,nombre,email,rol`, 401 |
| `POST /users` | soporte_ti | 201, 400 rol inválido, 409 correo duplicado, 403 |
| `GET /users` | soporte_ti | 200 sin contraseñas, incluye `creadoEn` y `ultimoAcceso` |
| `PATCH /users/:id/rol` | soporte_ti | 200, 400 si es tu propio rol |
| `DELETE /users/:id` | soporte_ti | 200 con el perfil eliminado, 400 si es tu propia cuenta, 404 inexistente, 403 |
| `GET /tecnicos` | tecnico, soporte_ti | 200 `[{id,nombre,email,rol}]` |
| `GET /incidencias` | reportante, tecnico, soporte_ti | 200 `{items,total,pages,page}` |
| `POST /incidencias` | reportante, soporte_ti | 201 con folio, 400 |
| `GET /incidencias/export` | soporte_ti | 200 documento de control |
| `GET /incidencias/:id` | reportante, tecnico, soporte_ti | 200 con URLs firmadas, 403, 404 |
| `PATCH /incidencias/:id/estado` | tecnico, soporte_ti | 200, 400 transición inválida o motivo obligatorio, 403 |
| `PATCH /incidencias/:id/autorizacion` | soporte_ti | 200, 400 rechazo sin motivo, 403, 409 ya resuelta |
| `POST /incidencias/:id/intervenciones` | tecnico, soporte_ti | 200 con `$inc` de horas, 400 |
| `PATCH /incidencias/:id/asignar` | soporte_ti | 200, 400 id inexistente, 409 sin autorización |
| `PATCH /incidencias/:id/prioridad` | soporte_ti | 200 |
| `PATCH /incidencias/:id/etiquetas` | reportante, tecnico, soporte_ti | 200, 400 sin cambios |
| `POST /incidencias/:id/evidencias` | reportante, soporte_ti | 201, 400, 403, 409, 413 |
| `GET /export/excel` | soporte_ti | 200 `.xlsx` (ExcelJS) |
| `GET /kb` | los cuatro roles | 200 listado y `?q=` |
| `POST /kb` | tecnico, soporte_ti | 201, 400 sin contenido, 403 |
| `DELETE /kb/:id` | soporte_ti | 200, 404 |
| `GET /stats` | soporte_ti, directivo | 200 agregados, 403 |

Parámetros de consulta de `/incidencias`: `q` (texto en español), `estado`, `categoria`, `prioridad`, `edificio`, `etiqueta`, `autorizacion` (`pendiente|aprobada|rechazada`), `page` y **`limit`** (1 a 50; se recorta si pides más). No existen `limite` ni `asignadaA`: el alcance del técnico es automático.

Cualquier ruta no declarada responde 404 JSON y las excepciones se convierten en 400/409/413/500 según el error de Mongoose, Multer o Express. No hay endpoint de borrado de incidencias por diseño (trazabilidad).

## 7. Interfaz web

React 18 + TypeScript + Vite + Tailwind 4, instalable como PWA. Un cliente distinto por rol:

- **Reportante:** alta con campos por categoría, sus incidencias, seguimiento y evidencia. Los borradores se guardan en IndexedDB si pierde la conexión.
- **Técnico:** bandeja de asignaciones, cambio de estado, intervenciones con horas.
- **Soporte TI:** bandeja de autorización, asignación, prioridad, etiquetas, analítica y exportación. La pantalla de usuarios es un panel de control: cabecera con el total de perfiles y los visibles según el filtro, búsqueda en tiempo real por nombre o correo, selector de rol como filtro, tabla con columnas Usuario (nombre + ID corto), Email, Rol, Registro, Último acceso y Acciones. La columna **Rol es estática** (insignia de color: Soporte TI rojo, Directivo azul, Técnico índigo, Reportante gris); el cambio de rol y la baja viven en el botón **⋯** de Acciones, que ofrece *Cambiar rol* (diálogo con los otros tres roles y su descripción, *Guardar cambio* deshabilitado hasta elegir) y *Eliminar cuenta* (cuadro `role="alertdialog"`, cierra con `Esc`, el foco recae en *Cancelar*). Tu propia fila no muestra botón: el backend rechaza autoasignarse otro rol o darse de baja. No hay formulario de alta en esta pantalla; las cuentas nacen con el registro público o con `seed`. El menú se pinta con `createPortal` sobre `document.body` y coordenadas fijas (se voltea hacia arriba si no cabe) porque el `overflow` de la tarjeta y el `transform` del hover recortaban el desplegable. Paginación de 8 y estado de carga con filas de esqueleto en pulso más *spinner* en el encabezado.
- **Directivo:** tablero de indicadores, sin acceso a expedientes.

Común a todos los roles: el botón de perfil del encabezado (`aria-haspopup="dialog"`, `aria-expanded`) abre una ficha modal con nombre, correo, rol activo, fecha de registro, último acceso, identificador y la descripción del rol. Se cierra con `✕`, *Volver* o `Esc` **sin salir de la aplicación**; *Cerrar sesión* vive dentro de esa ficha y limpia el token `t` más los borradores locales `c:*` antes de volver al inicio.

Sistema visual declarado en `client/src/index.css` (Tailwind 4, sin `tailwind.config.js`): encabezados `.page-header h1` en **Sora** 800 con `letter-spacing:-.025em`, de 24 px a 30 px desde 1024 px, subtítulo de 12 px a 14 px en slate-500; las tarjetas `.app-card` usan elevación por capas (brillo interno superior + dos sombras laterales + sombra profunda) y al pasar el cursor suben `translateY(-4px) scale(1.008)`; la entrada de los bloques es `fadeUp` de 0.6 s con la curva `cubic-bezier(.22,1,.36,1)`. Todo el bloque queda desactivado con `prefers-reduced-motion: reduce`. La paleta sigue siendo emerald/slate y no se añadió modo oscuro ni blur: el proyecto no tiene tokens `hsl(var(--…))` ni `.dark`.

Verificado en el navegador contra la API local: alta → aprobación → asignación → transiciones → intervención (`$inc` de 2.0 a 4.5 horas con entrada en el historial) → carga de evidencia con vista previa de la URL firmada → base de conocimiento → bloqueo de exportación para el rol directivo. Revisión de accesibilidad: todos los controles con nombre legible por lector de pantalla, foco visible en botones y filas de tabla activables con `Enter`/`Espacio`.

## 8. Instalación y ejecución

```bash
# 1) Backend
cd server
npm install
# 2) Elige UNO de los dos caminos:
npm run dev:local   # sin Atlas ni Supabase: base en memoria + datos demo + API en 4100
npm run dev         # con credenciales reales de server/.env (API en 4000)

# 3) Frontend (otra terminal)
cd client
npm install
echo "VITE_API_URL=http://localhost:4100/api" > .env.local   # o 4000 si usas npm run dev
npm run dev         # http://localhost:5173 (5174 si el anterior está ocupado)
```

`npm run dev:local` levanta además un servidor de evidencias simuladas en el puerto 4101, amplía `AUTH_RATE` a 60 intentos y sembrará los datos de demostración. Para sembrar contra Atlas: `npm run seed` (usa `MONGODB_URI` y `SUPABASE_*` del `.env`; marca las incidencias con `origen: "demo"`). Los dos caminos no comparten datos: `dev:local` usa una base en RAM `UTM_Desk_Demo` que se borra al detener el proceso, así que el frontend apuntado a la API real mostrará lo que haya en Atlas (actualmente 2 cuentas y `incidencias` vacío hasta ejecutar el seed). Si necesitas el juego de pruebas en Atlas sin correr el seeder, `server/datos-demo/` (generado desde `dev:local`, no se versiona) trae `importar-en-mongosh.js` y un `.json` por colección; esa carpeta incluye hashes bcrypt de las cuentas demo, trátala como sensible.

Otros comandos: `npm run build` en `client` (type-check con `tsc --noEmit` + bundle), `npm start` en `server` (arranque sin `--watch`).

**Si el frontend se queda en la pantalla de login y no carga nada**, el navegador está bloqueando las peticiones por CORS. `CLIENT_URL` debe listar el origen **exacto** de Vite: arranca en `http://localhost:5173` y, si ese puerto está ocupado, pasa al 5174, así que lo seguro es `CLIENT_URL=http://localhost:5173,http://localhost:5174`. Los cambios en `server/.env` no se aplican solos (`node --watch` sólo reinicia con cambios en `.js`): detén la API con `Ctrl+C` y vuelve a lanzarla. Si al reiniciar aparece `Could not connect to any servers in your MongoDB Atlas cluster … IP isn't whitelisted`, tu IP actual ya no está en *Network Access* de Atlas; agrégala desde la consola de Atlas o trabaja con `npm run dev:local`, que no necesita Atlas ni Supabase.

## 9. Pruebas

| Qué | Comando | Resultado |
|---|---|---|
| Suite de API (58 aserciones: RBAC, RF-06/07, transiciones, operadores, índices, TTL, paginación, evidencias, etiquetas operativas, normalización de filtros, búsqueda con relevancia, baja de usuarios, último acceso y fecha de registro heredada) | `cd server && npm test` | **58/58** sobre MongoDB en memoria |
| Colección de Postman, 9 carpetas y 76 peticiones | `postman/UTM-Desk.postman_collection.json` | **76/76** códigos coincidentes en dos pasadas consecutivas contra `dev:local` |
| Datos de demostración | `cd server && npm run seed` | 24 incidencias, 18 con evidencias, 10 con fecha de resolución, 6 edificios, 27 archivos |
| Panel de usuarios en el navegador (`http://localhost:5173/` con `npm run dev:local`, 12 perfiles demo) | entrar como Soporte TI, abrir *Usuarios*, usar el botón ⋯ | Columna Rol como insignia estática (sin `select` por fila) y *Tu cuenta* en la fila propia; el menú ⋯ se pinta sobre `document.body` (`position:fixed`, `z-index:40`) y quedó dentro del viewport incluso en la última fila, donde se voltea hacia arriba; *Cambiar rol* abre un diálogo con los otros tres roles y *Guardar cambio* deshabilitado hasta elegir — al aplicar, la fila pasa a «Técnico» y aparece «El rol de Ana Cruz ahora es Técnico»; *Eliminar cuenta* abre `role="alertdialog"` con el aviso de trazabilidad y, al confirmar, la tabla baja a 11 con «Jorge Ramírez fue eliminado» mientras sus incidencias siguen mostrando su nombre; la ficha del encabezado muestra rol, registro, último acceso e identificador, cierra con `Esc` y mantiene la sesión |

La colección cubre los cuatro roles, aprobación y rechazo con motivo, asignación bloqueada sin autorización, transiciones legales e ilegales, operadores `$inc`/`$set`/`$push`/`$addToSet`/`$pull`, búsqueda textual en español, evidencias y los errores 400/401/403/404/409/413/429. Cada petición trae un test de estado y captura las variables (`id`, `idPendiente`, `tecnicoId`, `artId`, `idUsuario`, `idPropio`). La variable `sufijo` forma parte de los correos de alta: si repites la colección sobre la misma base, súbelo a 2, 3… para evitar los 409 por correo ya registrado.

Cuentas de demostración (contraseña `Demo.2026`, cámbiala con `DEMO_PASSWORD`): `reportante1@demo.utm.edu.mx`, `tecnico1@demo.utm.edu.mx`, `soporte@demo.utm.edu.mx`, `directivo@demo.utm.edu.mx`.

Lo que **no** se pudo verificar aquí: ejecución dentro de la aplicación Postman (las respuestas se obtuvieron con un ejecutor propio en Node que recorre la misma colección), Supabase real y MongoDB Atlas.

## 10. Estructura

```text
utm-desk/
├── README.md
├── DESIGN.md
├── .gitignore
├── client/            # React + Vite (src/App.tsx, src/api.ts, PWA)
├── server/
│   ├── index.js       # modelo, RBAC, rutas, agregaciones, índices
│   ├── dev-local.mjs  # API local sin Atlas/Supabase
│   ├── seed-demo.js   # 24 incidencias de demostración
│   ├── excel.js       # exportación con ExcelJS
│   ├── test/api.test.mjs
│   ├── revisar-db.cjs, auditar-incidencias.cjs, comparar-bases.cjs  # utilidades de diagnóstico
│   └── .env.example
└── postman/UTM-Desk.postman_collection.json
```

## 11. Seguridad

- Contraseñas con bcrypt y `select: false`; nunca se serializan en las respuestas.
- JWT firmado con `JWT_SECRET`; el rol se revalida en la base en cada petición.
- `helmet`, allowlist de CORS en `CLIENT_URL` (lista cerrada por origen exacto: hay que incluir cada puerto de Vite, `http://localhost:5173` y `http://localhost:5174`) y límite de 10 intentos de acceso por IP cada 15 minutos (`AUTH_RATE`).
- Carga de archivos solo en memoria, con filtro de tipo, tamaño y cantidad; la ruta interna del bucket no se expone.
- Validación en el servidor de los enums, los ObjectId, el rango de VLAN y la longitud de los textos.

### Advertencias para el equipo (sin resolver en este repositorio)

1. `server/.env`, `client/.env` y `client/.env.local` están versionados y contienen credenciales reales. **Rota esas claves** (Atlas, `service_role` de Supabase y `JWT_SECRET`) antes de cualquier push. El `.gitignore` recién creado evita nuevas filtraciones, pero Git sigue rastreados esos archivos: desusarlos requiere una decisión del equipo (`git rm --cached <archivo>`).
2. `node_modules/` está versionado (11 283 archivos); ahora queda excluido, aunque el historial conserva las copias.
3. La base declarada en `.env` (`UTM_Desk`) y las colecciones que escribe Mongoose requieren confirmar en Atlas qué base queda como definitiva.
4. Quedan filas de prueba de 2026-10-22 en el clúster compartido; su limpieza es decisión del equipo porque son datos ajenos a este entorno.

## 12. Revisión con Git

```bash
git status                      # revisa qué cambió antes de etapa
git diff -- server/index.js client/src/App.tsx README.md
git log --oneline -n 10
```

Sugerencia de divisiones de commit: (1) seguridad y autorización del backend, (2) rediseño de la interfaz por rol y accesibilidad, (3) suite de pruebas y colección de Postman, (4) documentación `.env.example`/README y `.gitignore`. Revisa con `git status` que ningún `.env` entre en el área de preparación antes de confirmar.

## 13. Equipo

- **Proyecto:** UTM Desk NoSQL Cloud
- **Asignatura:** Bases de Datos en la Nube
- **Equipo:** 3
- **Integrantes:** Adrian Oropeza, Carlos Sanches, Cesar Abdiel y Melania Moo
- **Docente:** Lizandro Israel Reyes Castillo
