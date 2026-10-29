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

Cuatro roles (`ROLES`). Una cuenta puede tener **varios roles a la vez**: el documento guarda
`roles: [rol]` (el conjunto que autoriza) y `rol` (el rol activo, el que se muestra como etiqueta
y se anota en el historial). Los permisos son la **unión** de los roles del conjunto, así que un
`soporte_ti + reportante` autoriza y además abre sus propios reportes.

| Rol | Puede |
|---|---|
| `reportante` | Crear incidencias propias, consultar su detalle, adjuntar evidencia, etiquetar, consultar la base de conocimiento |
| `tecnico` | Ver solo las incidencias asignadas, cambiar estado dentro de lo permitido, registrar intervenciones con horas, redactar artículos |
| `soporte_ti` | Todo lo anterior más: autorizar/rechazar, asignar técnico, cambiar prioridad, gestionar usuarios y repartir roles, exportar, borrar artículos |
| `directivo` | Solo indicadores (`/stats`): no lee expedientes ni exporta |

Cómo se aplica la autorización en el servidor:

- `rolesDe(u)` y `puede(u, ...roles)` (`server/index.js:25`) son el único punto donde se evalúa el
  conjunto; no hay comprobaciones sueltas de `u.rol` en las rutas.
- `auth(...roles)` descifra el JWT, **vuelve a leer los roles desde la base** en cada petición y ahí
  aplica el filtro. Por eso asignar un rol extra a una cuenta surte efecto con el token ya emitido,
  y retirar un rol lo pierde al instante.
- `scope(user)` restringe `/incidencias`: la unión de la bandeja de técnico y los reportes propios;
  Soporte TI ve todo. Un `directivo` sin otros roles no recibe listado (403).
- `puedeVer(user, incidencia)` decide el acceso al detalle y a las evidencias con la misma unión; el
  directivo puro devuelve `false` (solo agregados).
- Los permisos se comprueban **antes** de tocar datos: un rol no autorizado recibe 403, no un 404
  engañoso ni una escritura parcial.
- Invariantes multirol: un hook `pre('validate')` del schema deja `roles` sin duplicados y nunca con
  un `rol` activo fuera del conjunto (si ocurre, se toma el primero). El registro público ignora lo
  que envíe el cliente y siempre crea `['reportante']`. Nadie puede quitarse `soporte_ti` a sí mismo
  ni dejar el panel sin un Soporte TI (`esUltimoSoporteTI` en `PATCH /users/:id/rol` y
  `PUT /users/:id/roles`).

Cambiar de rol activo desde la interfaz (mecanismo adaptado de *Innovaplay/Base44*): el rol elegido
se guarda en `localStorage['activeRole_<id>']` (`client/src/roles.ts`). Es **solo navegador**: no
escribe en MongoDB ni re-emite el JWT, así que el campo `rol` de la base conserva el rol con el que
la cuenta fue creada o asignada y la autorización del servidor **no cambia** —`auth()` sigue
evaluando la unión de `roles` (verificado: `GET /api/users` responde 200 con
`activeRole_… = tecnico` porque el conjunto del usuario todavía incluye `soporte_ti`). Lo único que
gobierna el rol activo es lo que la interfaz muestra y por dónde navega.

`rolActivo(usuario, roles)` (`client/src/roles.ts:29`) resuelve en este orden, igual que `me()` del
proyecto de referencia: el valor guardado en `localStorage` si sigue asignado; si no, el `rol` de la
base cuando pertenece al conjunto; y si ninguno aplica, el de mayor prioridad según
`PRIORIDAD_ROL = ['soporte_ti','tecnico','directivo','reportante']`. Al cerrar sesión
`olvidarRolActivo()` borra la clave, y al cambiar de rol `cambiarRol()` redirige a la vista de
arranque de ese rol (`VISTA_ROL`), que es el equivalente al `getRoleDashboardPath()` del proyecto
original.
Repartir roles desde la interfaz: **Usuarios → ⋯ → Asignar roles** abre un diálogo de casillas de
verificación (una por rol) que envía `PUT /api/users/:id/roles`. La propia cuenta también ofrece ese
menú —es la forma de que un Soporte TI se añada `reportante` para probar el alta—, pero no la baja.
La tabla muestra una etiqueta por rol y marca con `·` el activo; la cabecera y la ficha de perfil
muestran el conjunto (`Soporte TI · Reportante · Técnico`). El desplegable de asignación del detalle
se alimenta de `GET /api/tecnicos`, que devuelve cualquier cuenta con el rol técnico en su conjunto, y
`PATCH /incidencias/:id/asignar` acepta esas mismas cuentas con `puede(t, 'tecnico')`: si se filtrara
solo por `rol == 'tecnico'`, la interfaz ofrecería un nombre que el servidor rechazaría con 400.

`bootstrap()` migra roles heredados (`usuario → reportante`, `admin → soporte_ti`) y, además, pone al
día el conjunto `roles` de las cuentas anteriores al modelo multirol: escribe `[rol]` donde falta y
reconcilia los documentos cuyo `rol` se cambió a mano. No toca un arreglo que ya contenga el rol
activo, así que las asignaciones multirol existentes se conservan. También garantiza que la cuenta de
`ADMIN_EMAIL` exista como Soporte TI: la crea si no está, la asciende si su documento todavía trae
`admin` y le aplica `ADMIN_PASSWORD` cuando el hash guardado no coincide. La capa de autorización
acepta esos valores antiguos como alias (`ROL_ALIAS` en `server/index.js`), así que una cuenta creada
como `admin` recupera el panel completo aunque la migración no se haya ejecutado; las respuestas de
la API siempre devuelven el rol normalizado. Consecuencia a tener presente: quien pueda editar
`server/.env` y reiniciar el servidor restablece la contraseña de esa cuenta. `npm run dev:local`
también respeta `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

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

- `resolver` solo para quien tenga `tecnico` o `soporte_ti` en su conjunto de roles; `cerrar` solo para `soporte_ti`.
- Una transición no permitida devuelve **400** y no escribe nada.
- Cada incidencia nace con `autorizacion.estado = pendiente`. `PATCH /incidencias/:id/asignar` responde **409** mientras la solicitud no esté aprobada (RF-07).
- `/autorizacion` solo es de Soporte TI; aprobar sin motivo está permitido, **rechazar exige `motivo`** (400 si viene vacío) y el rechazo cierra la incidencia (`estado = Cerrada`, `fechaResolucion` fijada).
- `/auth/me` devuelve `id`, `nombre`, `email`, `rol` y `roles` (el conjunto que autoriza) para que el cliente reanude la sesión, valide la propiedad de sus incidencias tras recargar y reconstruya el menú cuando la cuenta ya tiene más de un rol. El cliente escucha `focus`, `visibilitychange` y el evento `sesion-cambiada` para volver a pedirlo, así que un rol recién asignado aparece en la navegación sin cerrar sesión.

Toda acción deja entrada en `historial` con autor, rol, comentario y estados anterior/nuevo.

## 4. Modelo de datos

Cuatro colecciones en MongoDB, con los nombres que realmente usa Mongoose:

| Colección | Contenido |
|---|---|
| `incidencias` | Ticket completo: folio, campos comunes, `datosCategoria`, `reportante`, `tecnico`, `evidencias`, `historial`, `autorizacion`, `horasTotales`, `fechaResolucion`, `origen` |
| `users` | `nombre`, `email` único en minúsculas, `password` (`select: false`, bcrypt), `rol` activo, `roles` (conjunto que autoriza), `avatar`, `ultimoAcceso` y timestamps de registro. `bootstrap()` completa `createdAt` con la fecha que ya trae el `ObjectId` de los perfiles creados antes de activar los timestamps y reconcilia `roles` con el `rol` activo |
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
| `$set` | estado y `fechaResolucion`, prioridad, técnico asignado, `autorizacion.*`, cambio de rol, `avatar` (alta y baja de la foto) |
| `$push` | `historial` en cada acción; `evidencias` con `$each` al adjuntar archivos |
| `$addToSet` / `$pull` | `/etiquetas`: agrega sin duplicar y elimina sin reescribir el arreglo completo |

### Pipelines de agregación

`GET /stats` ejecuta nueve pipelines en paralelo: conteo por estado, horas promedio de resolución por edificio (`$subtract`/`$divide`), top 10 de etiquetas (`$unwind` + `$group` + `$sort` + `$limit`), distribución por categoría y prioridad, incidencias por edificio, carga abierta, tendencia mensual (`$year`/`$month`) y totales con `$cond` para pendientes. `GET /incidencias/export` usa `$match` + `$sort` para el documento de control.

## 5. Archivos: clasificación por operación y bucket

El bucket **lo decide el servidor según la operación**, nunca el cliente. `server/archivos.js` concentra la regla y no existe una sola escritura a Storage fuera de ella:

| Operación de la app | Bucket | Formatos | Límite |
|---|---|---|---|
| Adjuntar evidencia a una incidencia | `SUPABASE_BUCKET_EVIDENCIAS` → `incidencias-evidencias` | JPG, PNG, WebP | 10 MB por archivo |
| Documento del expediente (PDF, Word, Excel, texto) | `SUPABASE_BUCKET_DOCUMENTOS` → `incidencias-documentos` | PDF, DOC, DOCX, XLS, XLSX, TXT | 20 MB por archivo |
| Foto de perfil del usuario | `SUPABASE_BUCKET_PERFILES` → `usuarios-archivos` | JPG, PNG, WebP | 5 MB |

- **Ningún cuerpo de petición acepta un parámetro de bucket.** `POST /incidencias*` y `PUT /users/:id/avatar` reciben solo el archivo; el servidor deriva el destino y lo guarda en la referencia (`evidencias[].bucket`, `avatar.bucket`). Los nombres se leen del entorno, así que puedes apuntarlos a los buckets que ya existen en tu proyecto sin crear un cuarto.
- **Validación por contenido real, no por lo que declara el navegador:** se leen los magic bytes (PNG, JPEG, WebP, PDF, ZIP→DOCX/XLSX, OLE2→DOC/XLS, NUL→rechazo), se contrastan con la extensión y con el `Content-Type` enviado, y solo entonces se sube. Un `.png` con bytes de ejecutable devuelve 400.
- El peso se comprueba **antes** de tocar Supabase, contra el límite del bucket destino; un PDF de 12 MB se rechaza como evidencia (10 MB) y pasa como documento (20 MB).
- Rutas únicas: `carpeta/<timestamp>-<aleatorio>-nombre.ext` con cada segmento saneado (`path.basename`, sin `..`), por lo que no se sobrescribe un archivo previo ni se sale de la carpeta del folio o del usuario.
- **MongoDB no guarda referencias inválidas.** Se valida el lote completo antes de escribir; si un archivo falla a mitad del lote, los ya escritos se eliminan con `storage.remove()` antes de responder 502, y si `Inc.create()`/`$push` falla se borran los objetos subidos. La autorización (`revisar()` en evidencias, dueño o Soporte TI en avatar) se resuelve antes de escribir en el bucket.
- **El reporte no se pierde si falla Storage.** `POST /incidencias` crea el expediente con `evidencias: []` y devuelve un campo `aviso` cuando el servidor no pudo escribir los archivos —ya sea por faltaren `server/.env` las variables `SUPABASE_URL`/`SUPABASE_SECRET_KEY`, porque la clave la bloquee el RLS o porque el antivirus rompa el TLS—; el aviso cita el motivo traducido y la confirmación del cliente lo muestra. Adjuntar evidencia a un expediente existente o cambiar la foto sí responde **503/502**, porque ahí el único objetivo de la petición era el archivo. Un rechazo por el propio archivo (formato 400 o tamaño 413) sigue impidiendo el alta: eso sí es culpa de lo que se envió.
- Metadatos por objeto: `path`, `bucket`, `nombre` original, `tipo` MIME real, `size`, `fecha` y `subidoPor`, además del `folio` de la incidencia o el `_id` del usuario en la ruta.
- La subida la hace **el servidor** con `SUPABASE_SECRET_KEY` (se acepta `SUPABASE_SERVICE_KEY` por compatibilidad; se unificó la lectura en `claveSupabase()`). Ninguna clave entra en `client/` ni en variables `VITE_`, y ningún nombre de bucket o ruta se registra en los logs: el arranque solo imprime `evidencias → incidencias-evidencias (10 MB) · …`.
- Lectura: `firmarURL()` pide `createSignedUrl(path, 3600)` **en el bucket que guarda cada referencia**, así que el enlace expira en una hora y los buckets permanecen privados. Las referencias antiguas sin campo `bucket` se siguen firmando desde `SUPABASE_BUCKET` (histórico `evidencias`); no se movió ni borró ningún objeto existente.
- Orden de validaciones en `POST /incidencias/:id/evidencias`: 404 si no existe, 403 si no es tuya (y no eres Soporte TI), **409 si está `Cerrada`**, 400 si ningún archivo pasó el filtro, 413 si excede el límite del bucket.
- `npm run dev:local` simula Storage con un mapa en RAM que **solo conoce los tres buckets** (y el histórico): escribir en un bucket inexistente falla igual que en el proyecto real, y los objetos se sirven por su URL firmada desde `http://localhost:4101`. **Eso no demuestra la integración con Supabase.**

**Comprobado contra el proyecto real de Supabase (2026-10-28, con la clave `secret` en
`SUPABASE_SECRET_KEY` y `NODE_EXTRA_CA_CERTS` por el TLS del antivirus):** `listBuckets()` devuelve
`incidencias-evidencias`, `incidencias-documentos` y `usuarios-archivos`, y `node server/probar-storage.mjs`
sube → firma → descarga → borra en los tres (**3/3**). La cadena completa de la API también se
verificó con una base MongoDB desechable (`verificar-supabase.mjs`, fuera del repositorio): el alta
con PNG + PDF dejó **dos archivos en buckets distintos según su operación**, la API firmó URLs
`https://<proyecto>/storage/v1/object/sign/…` que respondieron **HTTP 200** con los bytes exactos,
`POST /incidencias/:id/evidencias` adjuntó una tercera evidencia, `PUT`/`GET`/`DELETE /users/:id/avatar`
escribieron, firmaron y retiraron la foto en `usuarios-archivos/usuarios/<id>/…`, y MongoDB quedó con
`bucket` + `path` en las tres referencias. **Ninguna escritura tocó Atlas** (base en memoria).

**Archivos reales dejados en los buckets (2026-10-28):** la misma cadena se ejecutó con imágenes y
documentos tomados del gestor de archivos del equipo (`subir-reales.mjs`, fuera del repositorio), sin
borrar nada al terminar. Un PNG de 315 299 B y un JPG de 106 932 B quedaron en `incidencias-evidencias`,
un PDF de 269 351 B en `incidencias-documentos` y un JPG de 30 520 B como foto de perfil en
`usuarios-archivos`; cada URL firmada devolvió HTTP 200 con **exactamente los bytes del original**. El
inventario final del proyecto es **6 objetos**: esos cuatro más los dos PNG de 70 B que quedaron de la
primera pasada (se dejaron a propósito). Son referencias vivas solo en la base en memoria usada por el
script, no en Atlas; si alguien las ve en la consola de Supabase sin expediente asociado, ese es el
motivo.

Antes de eso, la misma prueba con la **`publishable`** (y con la `anon`) falló las tres subidas con
`new row violates row-level security policy` y `listBuckets()` no devolvía nada: esas claves actúan
como el rol `anon`. Como control, el intento contra un bucket inventado responde `Bucket not found`,
así que el bloqueo era de RLS y no de nombres. Consecuencia práctica: **la subida solo funciona con
la clave secret**; con `SUPABASE_URL` real pero la clave vacía o pública, la API responde 502/`aviso`
en lugar de fingir que guardó el archivo.

## 6. API REST

Base: `http://localhost:4000/api` (producción local, escribe en MongoDB Atlas) o `http://localhost:4100/api` (`dev:local`, base en memoria desechable). Autenticación: cabecera `Authorization: Bearer <token>`.

| Método y ruta | Roles | Respuestas |
|---|---|---|
| `GET /estado` | público | 200 `{almacen, storage}`: `atlas` o `local` según el host de la conexión activa (no de `MONGODB_URI`), y `storage:{hay,buckets,motivo}` según el sondeo de Supabase del arranque; la interfaz los usa para no anunciar Atlas ni archivos guardados sin estarlo |
| `POST /auth/register` | público | 201 (ignora el rol privilegiado enviado), 400, 409, 429 |
| `POST /auth/login` | público | 200 `{token,user}`, 401 genérico, 429 |
| `GET /auth/me` | cualquiera | 200 con `id,nombre,email,rol,roles`, 401 |
| `POST /users` | soporte_ti | 201, 400 rol inválido o sin roles, 409 correo duplicado, 403 |
| `GET /users` | soporte_ti | 200 sin contraseñas, incluye `roles`, `creadoEn` y `ultimoAcceso` |
| `PATCH /users/:id/rol` | soporte_ti | 200, 400 si es tu propio rol, 400 a quien es el último Soporte TI; **reemplaza** el conjunto por uno solo |
| `PUT /users/:id/roles` | soporte_ti | 200 con el perfil, 400 si el conjunto queda vacío o repite un alias, 400 si te quitas Soporte TI, 400 si eres el último Soporte TI, 404 |
| `DELETE /users/:id` | soporte_ti | 200 con el perfil eliminado, 400 si es tu propia cuenta, 404 inexistente, 403 |
| `GET /tecnicos` | tecnico, soporte_ti | 200 `[{id,nombre,email,rol,roles}]`; cualquier cuenta con el rol técnico en su conjunto, aunque su rol activo sea otro |
| `GET /edificios` | reportante, tecnico, soporte_ti | 200 arreglo con los `edificio` **distintos que existen en la base** dentro del alcance de la cuenta, ordenados sin tildes ni mayúsculas; directo y reportante reciben 403 |
| `GET /incidencias` | reportante, tecnico, soporte_ti | 200 `{items,total,pages,page}` con el alcance = unión de los roles de la cuenta |
| `POST /incidencias` | reportante (basta con tener el rol en `roles`) | 201 con folio, `aviso` + `evidencias: []` si el archivo no pudo guardarse (sin credenciales, RLS o TLS), 400, 403 a quien no tenga el rol |
| `GET /incidencias/export` | soporte_ti | 200 documento de control |
| `GET /incidencias/:id` | reportante, tecnico, soporte_ti | 200 con URLs firmadas, 403, 404 |
| `PATCH /incidencias/:id/estado` | tecnico, soporte_ti | 200, 400 transición inválida o motivo obligatorio, 403 |
| `PATCH /incidencias/:id/autorizacion` | soporte_ti | 200, 400 rechazo sin motivo, 403, 409 ya resuelta |
| `POST /incidencias/:id/intervenciones` | tecnico, soporte_ti | 200 con `$inc` de horas, 400 |
| `PATCH /incidencias/:id/asignar` | soporte_ti | 200, 400 `tecnicoId` sin el rol técnico, 409 sin autorización |
| `PATCH /incidencias/:id/prioridad` | soporte_ti | 200 |
| `PATCH /incidencias/:id/etiquetas` | tecnico, soporte_ti | 200, 400 sin cambios o sobre 10 etiquetas, 404/403 según `revisar` |
| `POST /incidencias/:id/evidencias` | reportante dueño, técnico asignado, soporte_ti | 201 (evidencia o documento según el contenido), 400, 403, 409 incidencia cerrada, 413 |
| `GET /users/:id/avatar` | dueño o soporte_ti | 200 `{avatar:{url,path,bucket,tipo,size,fecha}}` con URL firmada, `{avatar:null}` sin foto, 403, 404 |
| `PUT /users/:id/avatar` | dueño o soporte_ti | 200 con el perfil, 400 si no es imagen válida, 413 sobre 5 MB, 403 |
| `DELETE /users/:id/avatar` | dueño o soporte_ti | 200 `{avatar:null}` y objeto eliminado del bucket, 403 |
| `GET /export/excel` | soporte_ti | 200 `.xlsx` (ExcelJS) |
| `GET /kb` | los cuatro roles | 200 listado y `?q=` |
| `POST /kb` | tecnico, soporte_ti | 201, 400 sin contenido, 403 |
| `DELETE /kb/:id` | soporte_ti | 200, 404 |
| `GET /stats` | soporte_ti, directivo | 200 agregados, 403 |

La columna «Roles» es el `auth(...)` de cada ruta y se evalúa contra el conjunto `roles` de la cuenta: basta con que uno de los roles asignados aparezca ahí, no hace falta que sea el rol activo. Por eso una cuenta con `['soporte_ti','reportante']` puede abrir el reporte y a la vez gestionar usuarios.

Parámetros de consulta de `/incidencias`: `q` (texto en español), `estado`, `categoria`, `prioridad`, `edificio`, `etiqueta`, `autorizacion` (`pendiente|aprobada|rechazada`), `desde`, `hasta`, `page` y **`limit`** (1 a 50; se recorta si pides más). No existen `limite` ni `asignadaA`: el alcance del técnico es automático.

Los cuatro filtros de enumeración (`estado`, `categoria`, `prioridad` y `autorizacion`) se canonizan: da igual `estado=EN PROCESO`, `estado=En%20proceso` o `categoria=Computo y telecomunicaciones` sin la tilde de *Cómputo* — la consulta se arma con el valor exacto del enum y solo un valor que no existe (p. ej. `estado=Fantasma`) devuelve 400. `edificio` se compara tal cual, por eso el desplegable de la web se llena con `GET /edificios` y no con una lista fija. `etiqueta` ignora mayúsculas y acepta el `#` (`#poE` y `poe` encuentran el mismo tag), y `desde`/`hasta` son **inclusivos por día local**: `desde=2026-05-03` incluye desde las 00:00:00 de ese día y `hasta=2026-05-03` hasta las 23:59:59.999, no la medianoche UTC que se tragaba el primer día. `q` usa el índice de texto `texto_incidencias` (`default_language: spanish`, títulos con peso 10 y descripciones 3) y ordena por relevancia. `GET /stats`, `GET /export/excel` y `GET /incidencias/export` arman su `$match` con la misma función `filtrosQuery`, así que un filtro no puede cambiar de significado entre la lista, el Excel y los indicadores. La búsqueda de `/kb?q=` también es insensible a tildes y mayúsculas (`regexTexto` expande cada letra a su familia acentuada), a diferencia del `new RegExp` anterior.

Cualquier ruta **`/api`** no declarada responde 404 JSON y las excepciones se convierten en 400/409/413/500 según el error de Mongoose, Multer o Express. Fuera de `/api`, si existe `client/dist` la misma aplicación se responde con el `index.html` de la web (fallback de la SPA), que es como se sirve el despliegue de un solo servicio. No hay endpoint de borrado de incidencias por diseño (trazabilidad).

## 7. Interfaz web

React 18 + TypeScript + Vite + Tailwind 4, instalable como PWA. La interfaz **es multirol y cambia de rol en caliente**: el menú lateral, los botones del encabezado y la vista a la que te mueves los define el **rol activo** (`NAV_ROL` en `client/src/roles.ts`), mientras el servidor sigue autorizando por la **unión** de `roles`. La cuenta elige su rol desde la pastilla del encabezado; al confirmar, la aplicación guarda el rol en *localStorage*, redibuja la navegación y aterriza en la pantalla de arranque de ese rol (`VISTA_ROL`), sin recargar ni cerrar sesión. Una cuenta con `['soporte_ti','reportante']` ve *Registrar incidencia* solo con Reportante activo y *Usuarios* solo con Soporte TI activo, pero en ambos casos la API le respeta los permisos de los dos roles. Las secciones por rol son `soporte_ti` → Panel, Incidencias, Por autorizar, Usuarios, Estadísticas, Base de conocimiento; `tecnico` → Mi bandeja, Incidencias asignadas, Base de conocimiento; `reportante` → Panel, Incidencias, + Nueva incidencia, Base de conocimiento; `directivo` → Panel de indicadores, Base de conocimiento. Un `useEffect` de guarda (`SECCIONES` + `NAV_ROL`) redirige si la vista abierta no existe en el rol recién activado, y el botón *+ Nueva incidencia* del encabezado solo aparece si `nueva` está en el menú del rol activo.

- **Reportante:** suma el ítem «+ Nueva incidencia», el botón del encabezado y la lista «Mis incidencias». Es el único rol con permiso en `POST /incidencias`, así que quien no lo tenga en su conjunto recibe 403 y la pantalla muestra *SinRol* con la indicación de que un Soporte TI se lo asigne en *Usuarios → ⋯ → Asignar roles*. Campos por categoría, seguimiento y evidencia; los borradores se guardan en IndexedDB si pierde la conexión. En el bloque **4 · Evidencias** se aceptan imágenes (10 MB) y documentos del expediente (20 MB) —JPG, PNG, WebP, PDF, DOC, DOCX, XLS, XLSX, TXT, hasta 5 archivos— y cada fila muestra en qué bucket quedará (`INCIDENCIAS-EVIDENCIAS` o `INCIDENCIAS-DOCUMENTOS`) más su peso, con un **✕** por archivo para quitarlo de la selección antes de enviar (`aria-label="Quitar <nombre> de las evidencias"`); el detalle del expediente repite la etiqueta y el ✕ en el lote pendiente, con *Descartar todo*.
- **Técnico:** bandeja de asignaciones, cambio de estado, intervenciones con horas, base de conocimiento.
- **Soporte TI:** bandeja de autorización, asignación, prioridad, etiquetas, analítica y exportación. El alta de incidencias **no** aparece en su menú; solo se ve si activa el rol Reportante (y aunque no lo vea, el servidor le autoriza cualquier acción de los roles de su conjunto). La pantalla de usuarios es un panel de control: cabecera con el total de perfiles y los visibles según el filtro, búsqueda en tiempo real por nombre o correo, selector de rol como filtro (coincide si el rol está en el conjunto, no solo si es el activo), tabla con columnas Usuario (nombre + ID corto), Email, Rol, Registro, Último acceso y Acciones. La columna **Rol** pinta una insignia por cada rol asignado y marca con `·` el activo (Soporte TI rojo, Directivo azul, Técnico índigo, Reportante gris). El botón **⋯** de Acciones ofrece *Asignar roles* (diálogo con las cuatro casillas y su descripción, cada una con `aria-label`, *Guardar N rol(es)* deshabilitado hasta cambiar el conjunto, `PUT /users/:id/roles`) y *Eliminar cuenta* (cuadro `role="alertdialog"`, cierra con `Esc`, el foco recae en *Cancelar*). Tu propia fila muestra *Asignar roles* —así un admin puede ampliarse el alcance sin recrear la cuenta— pero no *Eliminar cuenta*. No hay formulario de alta en esta pantalla; las cuentas nacen con el registro público o con `seed`. El menú se pinta con `createPortal` sobre `document.body` y coordenadas fijas (se voltea hacia arriba si no cabe) porque el `overflow` de la tarjeta y el `transform` del hover recortaban el desplegable. Paginación de 8 y estado de carga con filas de esqueleto en pulso más *spinner* en el encabezado. Al guardar el conjunto, el cliente dispara `sesion-cambiada` y vuelve a leer `/auth/me`, así que la navegación cambia sin cerrar sesión.
- **Directivo:** tablero de indicadores, sin acceso a expedientes ni exportación (a menos que se le sume otro rol).

Común a todos los roles: cuando la cuenta tiene **más de un rol**, el encabezado muestra una pastilla con el rol activo (`PUNTO_ROL` da el color del punto, `ROL_LABEL` el texto, `▾` indica que es desplegable, `aria-haspopup="dialog"` y `title="<rol> — cambiar de rol"`); con un solo rol la pastilla **no se renderiza**, igual que en el proyecto de referencia. Al hacer clic se abre el diálogo **«Cambiar de Rol»** —título, descripción «Selecciona el rol que deseas usar en esta sesión.» y una tarjeta por rol asignado con su punto de color, `ROL_LABEL`, `ROL_DESC`, la marca `(en uso)` en el activo y `✓` en el seleccionado— más *Cancelar* y *Confirmar*, este último deshabilitado hasta elegir un rol distinto. `Esc` lo cierra. Su pie aclara que cambiar de rol solo reordena el menú y que asignar o quitar roles sigue siendo tarea de Soporte TI. La ficha de perfil del encabezado muestra el rol activo en la fila **Rol en uso**. el botón de perfil del encabezado (`aria-haspopup="dialog"`, `aria-expanded`) abre una ficha modal con nombre, correo, **roles asignados y su descripción**, fecha de registro, último acceso e identificador. Esa ficha incluye **FOTO DE PERFIL · JPG, PNG O WEBP · MÁX. 5 MB**: `Subir foto`/`Cambiar foto` envía `PUT /users/:id/avatar` en multipart (campo `avatar`), `Quitar foto` hace `DELETE` y la imagen se piden por `GET /users/:id/avatar`, que devuelve la URL firmada del bucket privado; si la URL expira o el archivo no existe, el `<img>` cae de nuevo en la inicial del nombre. El error del servidor se muestra en una línea `role="alert"` sin recargar la ficha. Se cierra con `✕`, *Volver* o `Esc` **sin salir de la aplicación**; *Cerrar sesión* vive dentro de esa ficha y limpia el token `t` más los borradores locales `c:*` antes de volver al inicio.

**Los iconos de perfil muestran la foto cuando la cuenta tiene una.** Hay tres sitios: el botón redondo del encabezado, la cabecera de la ficha de perfil y la columna *Usuario* de la pantalla de Usuarios. El encabezado y la ficha usan el estado `foto` (se pide al iniciar sesión, ya no solo al abrir el diálogo, para que el avatar esté disponible antes de tocar nada). Las filas de la tabla usan el componente `Avatar` de `client/src/App.tsx`, que recibe `id` y `nombre`, pide `GET /users/:id/avatar` y pinta `<img class="rounded-full object-cover" alt="Foto de perfil de <nombre>">` si hay URL firmada o, si no, la inicial de siempre en el círculo `bg-slate-100`. La URL se guarda en un mapa `AVATAR` por identificador porque la firma caduca a la hora y repetir la llamada en cada render saldría cara; un `onError` en el `<img>` devuelve la fila a la inicial si el objeto se borró o la firma expiró. `pub()` jamás publica la URL: el `<img>` la obtiene de la API, así que sigue rigiendo `dueñoOPerfil` (solo el dueño o Soporte TI), y una cuenta sin foto simplemente no dispara la carga.

**El filtro de ubicación sale de la base, no de una lista fija.** `EDIF` en `client/src/App.tsx` solo tenía cuatro nombres genéricos, así que un edificio real de Atlas (p. ej. *Biblioteca*) no se podía elegir aunque existiera en los expedientes. Ahora `useEdificios()` pide `GET /edificios` una sola vez (promesa compartida en `EDIF_CACHE`, sin recargar por render), la une con `EDIF` quitando duplicados con `uneEdificios` y `claveEdificio` (misma norma sin tildes ni mayúsculas que usa el servidor) y devuelve el arreglo para los dos selectores: *Ubicación* de la lista de incidencias y el filtro de *Estadísticas*. Si la API no contesta, el `catch` deja la lista base y la pantalla sigue funcionando igual que antes. Se verificó en el navegador sobre la base en memoria con 6 edificios: el desplegable pasó de 4 opciones a 6 con `Biblioteca` y `Rectoría` en su lugar y `?edificio=Biblioteca` dejó la tabla en 4 expedientes.

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

### Variables de entorno de Storage (`server/.env`)

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | URL real del proyecto (`https://xxxxx.supabase.co`). Con un placeholder el arranque avisa `⚠️ Storage sin configurar…` y las subidas responden 503. |
| `SUPABASE_SECRET_KEY` | Clave `secret`/`service_role` del servidor. `SUPABASE_SERVICE_KEY` sigue funcionando (`claveSupabase()` lee las dos; la primera gana). **Nunca** se copia a `client/` ni a una variable `VITE_`. |
| `SUPABASE_BUCKET_EVIDENCIAS` | Bucket de imágenes de evidencia (por defecto `incidencias-evidencias`, 10 MB). |
| `SUPABASE_BUCKET_DOCUMENTOS` | Bucket de documentos del expediente (por defecto `incidencias-documentos`, 20 MB). |
| `SUPABASE_BUCKET_PERFILES` | Bucket de fotos de perfil (por defecto `usuarios-archivos`, 5 MB). |
| `SUPABASE_BUCKET` | Bucket **histórico** (`evidencias`): solo se usa para firmar referencias guardadas antes de esta clasificación. Si tu proyecto ya tiene los tres buckets con otros nombres, apunta las variables anteriores a ellos; el código no crea buckets. |

**La `publishable` y la `anon` no sirven aquí.** La subida la ejecuta el servidor, sin sesión de Supabase Auth, así que con esas claves el request llega como el rol `anon` y las políticas RLS del bucket la rechazan (`new row violates row-level security policy`). No es un fallo del código: es el diseño —el navegador nunca habla con Supabase, habla con la API—. Por eso `client/package.json` tiene `@supabase/supabase-js` pero ningún archivo de `client/src` lo importa, y las variables `VITE_SUPABASE_*` están sin usar. Para activar las subidas reales hace falta la **`sb_secret_…`** (o la `service_role`) en `SUPABASE_SECRET_KEY`. La clave secret está hoy en `server/.env` (archivo ignorado, nunca commiteado); como también se compartió texto fuera del gestor de secretos, **rotenla** desde *Settings → API Keys* cuando termine la entrega y creadla de nuevo en el `.env`.

```bash
cd server && node probar-storage.mjs   # sube, firma, lee y borra un archivo de prueba en cada bucket
```

El script usa el mismo cliente y el mismo clasificador que la API, así que lo que falla ahí es lo que fallaría al guardar una evidencia desde la web; además prueba un bucket inventado para distinguir «no existe» de «RLS lo bloquea». Su salida no incluye claves. El traductor `motivoStorage()` (`server/index.js`) convierte los errores crudos de Supabase en estos dos mensajes accionables, y está fijado por un caso de `npm test`.

**TLS interceptado por el antivirus (bloqueo real de esta máquina).** Node rechaza cualquier llamada a `*.supabase.co` con `UNABLE_TO_VERIFY_LEAF_SIGNATURE` porque Avast sustituye el certificado por uno firmado con su propia raíz (*Avast Web/Mail Shield Root*), que no está en el almacén CA que trae Node (curl y el navegador sí la confían, así que el síntoma es «desde el navegador va, desde el servidor no»). **La solución es arrancar Node con `--use-system-ca`**, que ya traen los scripts de `server/package.json`:

```powershell
cd server
npm run dev          # node --use-system-ca --watch index.js  → Supabase responde
node index.js        # ✗ sin esa bandera, el TLS de Avast rompe todas las subidas
```

Verificado aquí (2026-10-28): `node --use-system-ca probar-storage.mjs` deja **3/3** subidas reales contra el proyecto y `listBuckets()` muestra los tres buckets; el mismo `fetch` sin la bandera muere en `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Alternativa sin bandera: `exportar-ca-antivirus.ps1` vuelca esa raíz a `%TEMP%\ca-antivirus.pem` (busca Avast, Kaspersky, ESET, Bitdefender, McAfee, Sophos, Fortinet, Zscaler, Websense en el almacén de Windows) y se arranca con `set NODE_EXTRA_CA_CERTS=%TEMP%\ca-antivirus.pem`.

**El arranque ahora sondea Supabase** (`sondeoStorage()` hace un `listBuckets()` con 6 s de margen) e imprime `🪣 Supabase responde: buckets visibles → …` o `⚠️ Supabase NO responde: <motivo traducido>`, nunca la clave. Ese diagnóstico viaja a tres sitios: el campo `storage` de `GET /api/estado` (`{ hay, buckets, motivo }`), el `aviso` de `POST /incidencias` cuando los archivos no se guardaron, y la interfaz: pastilla en el encabezado («● Archivos · Supabase (3 buckets)» en verde, «● Archivos sin guardar» en ámbar, con el motivo como tooltip) y una línea ámbar bajo el selector de evidencias del alta. Además **un fallo del servicio ya no pierde el reporte**: si Supabase rechaza la subida (502/503), `POST /incidencias` crea el expediente con su folio, deja `evidencias: []` y devuelve el `aviso` con el motivo; los problemas del archivo en sí (formato 400, tamaño 413) siguen rechazándose como antes.

El log de arranque también dejó de mentir: antes imprimía `✅ Conectado exitosamente a MongoDB Atlas (127.0.0.1)` incluso con la base en memoria. Ahora `bootstrap()` consulta la topología activa y dice `Conectado a MongoDB LOCAL (…) — NO escribe en Atlas` salvo que el host sea un cluster real, la misma fuente que usa `GET /estado`.

La alternativa es desactivar el *HTTPS scanning* en Avast. Conviene documentarlo al equipo: sin ese ajuste, **las subidas a Supabase fallan desde el servidor en cualquier equipo con el antivirus activo**, aunque las credenciales sean correctas.

**Si el frontend se queda en la pantalla de login y no carga nada**, el navegador está bloqueando las peticiones por CORS. `CLIENT_URL` debe listar el origen **exacto** de Vite: arranca en `http://localhost:5173` y, si ese puerto está ocupado, pasa al 5174, así que lo seguro es `CLIENT_URL=http://localhost:5173,http://localhost:5174`. Los cambios en `server/.env` no se aplican solos (`node --watch` sólo reinicia con cambios en `.js`): detén la API con `Ctrl+C` y vuelve a lanzarla. Si al reiniciar aparece `Could not connect to any servers in your MongoDB Atlas cluster … IP isn't whitelisted`, tu IP actual ya no está en *Network Access* de Atlas; agrégala desde la consola de Atlas o trabaja con `npm run dev:local`, que no necesita Atlas ni Supabase.

**Qué API está escribiendo tus datos.** `npm run dev` (4000) usa `MONGODB_URI` del `.env` y escribe en el cluster; `npm run dev:local` (4100) levanta una base en memoria con datos demo y **nada de lo que crees ahí llega a Atlas ni sobrevive al reiniciar**. `VITE_API_URL` de `client/.env.local` decide cuál de las dos usa la web, y la propia web lo reporta con `GET /api/estado` (banda ámbar y etiqueta del panel lateral cuando el almacén no es Atlas).

### Despliegue en un hosting gratuito

La aplicación **no es un sitio estático**: es una API Express que escribe en MongoDB Atlas y sube archivos a Supabase Storage. Desplegarla mal es la forma más rápida de romper lo que ya funciona, así que el repositorio trae dos caminos y cada uno con sus límites reales.

**Camino recomendado: un contenedor, un servicio.** `Dockerfile` (raíz del repo) compila la web en una etapa, instala solo las dependencias de producción de la API en otra y arma una imagen donde `server/index.js` sirve también `client/dist`. Al existir ambos en el mismo origen, el bundle construido en producción usa `/api` relativo (`client/src/api.ts`), no hace falta `CLIENT_URL` para CORS ni `VITE_API_URL`, y el PWA (`/manifest.webmanifest`, `/sw.js`) sale de la misma dirección. Se construye y corre así, sin que ninguna credencial entre en la imagen (`.dockerignore` excluye `**/.env` y `**/.env.*`; el `COPY server` del Dockerfile no las copiaría aunque existieran):

```bash
docker build -t utm-desk .
docker run --rm -p 4000:4000 --env-file server/.env utm-desk
# -> http://localhost:4000  (la web)  y  http://localhost:4000/api/estado  (sondeo de salud)
```

En cualquier host de contenedores se pega el mismo `--env-file` en su panel de variables. Las que necesita son las de `server/.env.example`, **solo los nombres**: `PORT`, `MONGODB_URI`, `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_BUCKET_EVIDENCIAS`, `SUPABASE_BUCKET_DOCUMENTOS`, `SUPABASE_BUCKET_PERFILES`, `SUPABASE_BUCKET`, `TTL_DIAS`, `AUTH_RATE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. `NODE_ENV=production` y `--use-system-ca` no van en el contenedor: ese flag existe solo para las máquinas con antivirus que inspecciona TLS (ver arriba), y en Linux no hay almacén de CA del sistema que consultar.

Dos cosas que hay que resolver en los paneles, no en el código:

1. **Atlas *Network Access*.** Un clúster de Atlas solo acepta conexiones desde IP listadas, y un servicio en la nube no tiene IP fija garantizada. Sin agregar `0.0.0.0/0` en *Network Access* el despliegue arranca y muere con `Could not connect to any servers`; con ese rango, cualquiera que tenga la cadena de conexión podría entrar al clúster. Es un cambio de seguridad del proyecto, no un detalle de configuración: **que lo decida el equipo y se rote la contraseña de la cadena** si ya se compartió. La alternativa sin abrir el rango es un host con IP dedicada (o el VPS de la escuela) y listar esa IP.
2. **Supabase Storage** funciona desde cualquier host porque la subida la hace el servidor con la `sb_secret_…`; el navegador nunca habla con Supabase.

**Vercel solo para la web (lo que hizo el equipo).** Vercel sirve este frontend sin problema: la carpeta `client/` con `client/vercel.json` (`framework: vite`, `buildCommand: npm run build`, `outputDirectory: dist`, reescritura SPA y `Cache-Control` largo para `/assets/*` con hash y `must-revalidate` para `sw.js`). Desde la terminal, después de un `npx vercel login` propio: `cd client && npx vercel --prod`. Lo que **no** debe migrar a Vercel es la API: en serverless, el cuerpo de una petición en el plan gratuito está limitado a ~4.5 MB y aquí se aceptan evidencias de 10 MB y documentos de 20 MB — las subidas empezarían a fallar con 413 sin que el código haya cambiado. Si se separan los servicios, define `VITE_API_URL` con la **URL absoluta** de la API en el panel de Vercel (las variables `VITE_*` se hornean en el bundle al compilar; cambiarlas exige redeploy) y pon ese origen en `CLIENT_URL` de la API. **Si ahí no la defines, el bundle caerá en `/api` y apuntará a la propia Vercel**, que no tiene rutas de API: la web abrirá pero cada petición fallará con «El servidor no respondió». En el contenedor de servicio único no pasa nada de eso porque `/api` sí existe. Un valor `http://localhost:4000/api` que quede en `client/.env` **no** viaja al bundle de producción: en build se descarta cualquier localhost y se usa el propio origen, precisamente para no publicar una web que llama a la laptop de quien compiló.

**Qué está verificado y qué no.** La topología de un solo servicio está comprobada: con `client/dist` construido, la API sirvió `GET / → 200 text/html` (el `index.html` de la SPA), `GET /incidencias → 200` con ese mismo HTML (fallback), `GET /manifest.webmanifest → 200 application/manifest+json`, `GET /assets/index-*.js → 200 application/javascript`, mientras `GET /api/estado` siguió respondiendo JSON y `GET /api/no-existe` su 404 JSON de siempre. En el navegador, entrando a la dirección de la API, la web cargó, el login de Soporte TI funcionó y la tabla de incidencias contestó **por el origen relativo `/api`** (24 documentos) — o sea que el bundle desplegado no necesita Vite ni CORS. También se comprobó el filtro de *Ubicación* sobre esa web servida por la API: el desplegable listó los 6 edificios de la base y `Biblioteca` dejó 4 expedientes. **No** se construyó la imagen: este equipo no tiene Docker ni CLI de Fly/Render/Heroku, así que `docker build` queda como verificación pendiente del día que se instale, y **no hay nada publicado en internet todavía** — desplegar requiere tu cuenta en el host elegido y sus credenciales, que no pasan por este repositorio ni por este chat.


| Qué | Comando | Resultado |
|---|---|---|
| Suite de API (92 casos: RBAC con alta exclusiva del reportante, RF-06/07, transiciones, operadores, índices, TTL, paginación, evidencias, clasificación por bucket según la operación, avatar con autorización propia, etiquetas operativas, normalización de filtros (mayúsculas, tildes y `desde`/`hasta` de día completo), etiqueta guardada con mayúsculas como el legado de Atlas, `GET /edificios` con su alcance por rol, búsqueda textual con relevancia y búsqueda de la base de conocimiento con o sin tildes, baja de usuarios, último acceso, fecha de registro heredada, `/estado` con su campo `storage`, la traducción de errores de Storage `motivoStorage`, el alta que conserva el expediente cuando Supabase rechaza la subida y 11 casos de roles múltiples) | `cd server && npm test` | **92/92** sobre MongoDB en memoria |
| Colección de Postman, 9 carpetas y 91 peticiones | `postman/UTM-Desk.postman_collection.json` | Las 89 peticiones anteriores **coinciden 89/89** ejecutándolas contra `npm run dev:local` con un ejecutor propio en Node (lee el código que declara cada `pm.test`, lo compara con la respuesta real y añade los chequeos de cuerpo del conjunto `roles`). El primer recorrido encontró y corrigió tres defectos de la propia colección: siete peticiones llevaban la cabecera `Bearer Bearer {{token…}}` (401 seguro), cuatro pedían la foto de perfil con el token de otra cuenta (por eso el avatar no se había verificado nunca desde Postman) y dos expectativas estaban desactualizadas: «Un técnico no puede adjuntar evidencias → 403» (desde CU-02 el técnico asignado sí puede → 201) y la carpeta 8, que ahora prueba también `PUT /users/:id/roles`, el alta con dos roles, la autoexpulsión de Soporte TI → 400 y el conjunto inventado → 400. Se agregaron dos peticiones (`GET /edificios` con Soporte TI y la misma como directivo → 403): su comportamiento está fijado por casos de `npm test` (92/92), pero **el re-recorrido completo de las 91 con el ejecutor queda pendiente** porque ese ejecutor no vive en el repositorio. **Dentro de la aplicación Postman sigue sin ejecutarse** (las respuestas las toma el ejecutor en Node) |
| **Filtros contra MongoDB Atlas real** | `cd server && node --use-system-ca filtros-atlas.mjs` (añade `--arregla` para crear los índices que falten sin borrar los existentes, y `--sembrar` para cargar `server/datos-demo/`) | **Verificado el 2026-10-28 contra el clúster del equipo: 61 comprobaciones, «todos los filtros responden igual por HTTP y por driver», salida 0.** El script importa el mismo `filtrosQuery` que usa la API, arma la consulta con el driver y la compara con `GET /api/incidencias` (mismo `total` y los mismos documentos por filtro): los 5 estados, las 4 categorías, las 4 prioridades, los 6 edificios de la base, los 3 estados de autorización, las etiquetas —incluida `poE` escrita con mayúsculas en Atlas—, `q` en español, rangos de fecha, combinaciones, paginación, `/stats`, `/export/excel`, `/kb?q=` y `/tecnicos`, más los cuatro valores inválidos que deben seguir respondiendo 400. Al correrlo destapó **cuatro defectos reales** que ninguna prueba local mostraba: `categoria=Computo…` sin tilde moría en 400 (los enums comparaban literal), `desde` perdía el primer día porque se parseaba en UTC, el desplegable de ubicación no podía elegir un edificio que no estuviera en la lista fija del cliente, y las etiquetas con mayúsculas del clúster eran inalcanzables. Los tres primeros quedaron corregidos y fijados con casos de `npm test`; el cuarto se arregló con la comparación insensible a mayúsculas. La semilla dejó en Atlas **20 incidencias `origen:"demo"`** (4 se saltaron por folio ya existente), **11 cuentas** y **4 artículos**, sin borrar ni sobrescribir nada; `server/datos-demo/importar-en-mongosh.js` documenta el revertido (`deleteMany({origen:'demo'})` y por correo `@demo.utm.edu.mx`), que **no** se ejecutó |
| Storage contra el proyecto real de Supabase | `cd server && node --use-system-ca probar-storage.mjs` y el mismo `verificar-supabase.mjs` (o `NODE_EXTRA_CA_CERTS=%TEMP%\ca-antivirus.pem`) | **Verificado con la clave `secret` (2026-10-28).** `listBuckets()` muestra `incidencias-evidencias`, `incidencias-documentos` y `usuarios-archivos`; el script sube/firma/descarga/borra en los tres (**3/3**). La verificación de extremo a extremo (API real + MongoDB desechable) dejó **13 comprobaciones OK**: alta con PNG+PDF en dos buckets distintos, URLs firmadas `…/storage/v1/object/sign/…` descargadas con HTTP 200 y los bytes exactos, adjuntar una tercera evidencia, `PUT`/`GET`/`DELETE` del avatar en `usuarios-archivos/usuarios/<id>/…` y `bucket`+`path` guardados en el documento. Con la `publishable` o la `anon` las tres subidas fallaban con `new row violates row-level security policy` (y un bucket inventado responde `Bucket not found`, el control que confirma que el bloqueo era de RLS). **Atlas no se tocó**: la base era en memoria. Sigue pendiente la subida escribiendo en Atlas (`npm run dev`, IP ya autorizada) y el contenido del bucket histórico `evidencias` |
| El arranque sondea Supabase y `--use-system-ca` decide el TLS | `node --use-system-ca index.js` vs `node index.js` (base en memoria, puerto 4211) | **Comprobado el 2026-10-28.** Con la bandera: `🪣 Supabase responde: buckets visibles → incidencias-evidencias, incidencias-documentos, usuarios-archivos` y `GET /api/estado` → `storage:{hay:true,buckets:[…3],motivo:""}`. Sin ella —caso literal de `node index.js`—: `⚠️ Supabase NO responde: … antivirus … arranca con npm run dev …` y `storage:{hay:false,…}`, que es lo que pinta la pastilla ámbar del encabezado y la línea bajo el selector de evidencias. `node --use-system-ca probar-storage.mjs` volvió a dar **3/3** subidas reales, así que la bandera es suficiente y `NODE_EXTRA_CA_CERTS` queda como alternativa |
| Archivos reales del gestor de archivos en Supabase | `node subir-reales.mjs` (script **fuera del repositorio**, en `..\subir-reales.mjs`, con `NODE_EXTRA_CA_CERTS=%TEMP%\ca-antivirus.pem`) | **Verificado y dejado en el proyecto (2026-10-28).** Cuatro archivos propios —PNG 315 299 B y JPG 106 932 B a `incidencias-evidencias`, PDF 269 351 B a `incidencias-documentos`, JPG 30 520 B a `usuarios-archivos`— pasaron por `POST /incidencias`, `POST /incidencias/:id/evidencias` y `PUT /users/:id/avatar`; las cuatro URLs firmadas descargaron HTTP 200 con los bytes exactos del original y el inventario final del proyecto arrojó **6 objetos** (los 4 nuevos + 2 PNG de 70 B de la pasada anterior, conservados por decisión del equipo). Nada se borró. **Atlas no se tocó**: la base fue en memoria, así que esas rutas no tienen expediente en la base real |
| Bug que destapó ese recorrido | `PATCH /incidencias/:id/asignar` filtraba `User.findOne({ _id: tecnicoId, rol: 'tecnico' })` | Una cuenta multirol aparecía en `GET /tecnicos` (porque el rol está en su conjunto) pero el servidor la rechazaba con 400 «Técnico inválido» si su rol activo no era `tecnico`: el desplegable ofrecía un nombre imposible de asignar. Ahora la ruta usa `puede(t, 'tecnico')`, el mismo criterio que `/tecnicos`, y `npm test` lo fija con un caso de asignación a una cuenta cuyo rol activo es `reportante`. También se amplió el aviso de arranque de `bootstrap()`, que buscaba `rol: 'soporte_ti'` suelto y no veía a un administrador multirol |
| Cambiar de rol en el navegador (`http://localhost:5173/` con `npm run dev:local`, cuenta `soporte@demo.utm.edu.mx` con `roles: [soporte_ti, reportante, tecnico]` asignados por `PUT /api/users/:id/roles` → 200) | pastilla del encabezado → diálogo *Cambiar de Rol* → *Confirmar* | **Comprobado en vivo.** La pastilla aparece solo con varios roles (`Soporte TI ▾`, `title="Soporte TI — cambiar de rol"`); el diálogo lista las tres tarjetas con su descripción, marca `(en uso)` y `✓` en la seleccionada, y mantiene *Confirmar* deshabilitado hasta elegir otro rol. Al confirmar a Técnico: la pastilla pasa a `Técnico ▾`, el menú queda en `▦ Mi bandeja / ▤ Incidencias / ? Base de conocimiento`, desaparece el botón *+ Nueva incidencia* del encabezado y se escribe `activeRole_6ae25490dd2fc29b18aa2072 = tecnico`. **Sobrevive a la recarga** (otra navegación completa a `/` sigue en Técnico con el mismo menú) y **la salida la borra** (`Cerrar sesión` → `localStorage` sin claves `activeRole_*` y de nuevo en el login). La **redirección** también ocurrió: desde *Registrar incidencia* (Reportante) se cambió a Técnico y la app aterrizó en *Centro de monitoreo*, la vista de arranque de ese rol. Con una cuenta de un solo rol (`tecnico1@demo.utm.edu.mx`) la pastilla **no se renderiza** y el menú es el de siempre. Queda demostrado que el cambio es solo de interfaz: con `activeRole_… = tecnico`, `GET /api/users` con el mismo token sigue devolviendo **200 y 12 cuentas** porque el servidor autoriza por la unión de `roles` y el campo `rol` de la base sigue valiendo `soporte_ti` |
| El usuario «no se guardó»: la interfaz anunciaba Atlas sin estarlo | `GET /api/estado` + `client/src/App.tsx` | La pantalla de alta y el panel lateral decían *MongoDB Atlas* en texto fijo, y el encabezado ponía «● Conectado · MongoDB Atlas» apenas con `navigator.onLine`. Con `VITE_API_URL` apuntando a 4100, el alta se escribía en la base en memoria de `dev:local` (desechable al reiniciar) mientras la pantalla aseguraba lo contrario: por eso un usuario creado desde la web parecía perdido. Ahora la API responde su almacén real leyéndolo de la **conexión activa** (`almacenDe(...)` sobre los hosts del driver, no de `MONGODB_URI`, que en pruebas y en `dev:local` puede apuntar al cluster), y el cliente usa ese dato en cuatro sitios: banda `role="status"` sobre el contenido, píldora del encabezado, tarjeta del panel lateral y textos de *Registrar incidencia* y *Centro de monitoreo*. Verificado en el navegador contra 4100: «● Conectado · base local (sin Atlas)», «Base de datos local · Ejecuta npm run dev (puerto 4000) para escribir en el clúster.», «Documentos indexados en la base conectada» y «…se indexará en la base de datos conectada.»; `npm test` fija el caso `local` bajo MongoDB en memoria y los hosts reales de un cluster |
| La foto de perfil se ve en los iconos | `npm run dev:local` (API 4100 + almacenamiento simulado en 4101) con un Vite temporal en `http://localhost:5174/`, cuenta `soporte@demo.utm.edu.mx` | **Comprobado en vivo (2026-10-28).** Tras subir `6bcfdc11002272ee00fb92fb4eac9cda.jpg` desde *Ver mi perfil → Subir foto* (`PUT /api/users/…/avatar`), el documento guarda `avatar:{tipo:"image/jpeg",size:30520,fecha:…}`, `GET /users/:id/avatar` responde **200** con una URL firmada `http://localhost:4101/usuarios-archivos%2Fusuarios%2F…jpg` y al descargarla llegan **30 520 bytes** con cabecera JPEG (`ffd8ff`). En la interfaz: el botón del encabezado contiene un `<img>` con `naturalWidth` **640** (el inicial ya no aparece), la ficha de perfil repite la imagen, y en *Usuarios* la fila de esa cuenta muestra `IMG: Foto de perfil de Soporte TI Demo 640x360` mientras las otras siete siguen con su inicial (`S`, `A`, `L`, `M`, `J`, `S`, `P`). El registro de red muestra **una sola llamada por cuenta** (8 filas = 8 `GET /users/:id/avatar`, todos **200**) y ninguna repetida al reabrir la pantalla, por la caché `AVATAR`. **Bug que destapó el recorrido:** el efecto de `Avatar` devolvía el resultado de `setUrl(...)` como si fuera limpieza (`return setUrl(src)`); React lo interpreta como función de retorno y la pestaña se quedaba colgada al entrar en *Usuarios* — el efecto ahora asigna estado y regresa únicamente la función `vivo=false` |
| Datos de demostración | `cd server && npm run seed` | 24 incidencias, 18 con evidencias, 10 con fecha de resolución, 6 edificios, 27 archivos. **Ojo:** `npm run seed` usa `MONGODB_URI` del `.env`, o sea el cluster real; para datos de prueba usa `npm run dev:local`, que siembra su propia base en memoria |
| Clasificación de archivos en la API local | `node verificar.mjs` (script de prueba fuera del repositorio, contra `http://localhost:4100/api`) | casos 1-10: PNG de incidencia → `incidencias-evidencias` (201), PDF → `incidencias-documentos` (201), DOCX como documento, foto de perfil → `usuarios-archivos` con URL legible 200, `.png` con bytes de ejecutable → 400 «no es un archivo admisible: binario sin tipo reconocido», imagen de 11 MB → 413 «menos de 10 MB», lectura/escritura de foto ajena → 403, MongoDB sin referencias huérfanas y listado de incidencias demo funcionando igual (5 expedientes) |
| Recorrido en el navegador (`http://localhost:5173/` con `npm run dev:local`, cuenta reportante) | alta de incidencia con PNG + PDF, adjuntar evidencia en el detalle, ficha de perfil | el formulario muestra *Imágenes 10 MB · documentos 20 MB · hasta 5 archivos* y etiqueta cada archivo elegido (`INCIDENCIAS-EVIDENCIAS` / `INCIDENCIAS-DOCUMENTOS`) antes de enviar; `UTM-2026-0026` quedó con tres evidencias y sus insignias de bucket, la imagen se renderiza desde la URL firmada del bucket privado y el PDF se abre como enlace; *Añadir evidencia* subió un PNG adicional con entrada «evidencia» en el historial; la ficha subió `perfil.png` a `usuarios-archivos/usuarios/<id>/…` (200×200 visible), *Quitar foto* volvió el control a *Subir foto*, un ejecutable renombrado `.png` mostró `«ejecutable.png» no es un archivo admisible: binario sin tipo reconocido` en la línea `role="alert"` y una imagen de 11 MB fue descartada en el cliente con «Solo imágenes (10 MB) o documentos (20 MB)» |
| Confirmaciones en pantalla (`http://localhost:5173/`, mismo recorrido) | registrar incidencia con adjunto y adjuntar evidencia suelta | banda verde `role="status"` al crear: «Incidencia UTM-2026-0026 registrada en MongoDB con 1 archivo(s) en su bucket»; al adjuntar: «1 archivo(s) guardado(s) en incidencias-evidencias» junto a la insignia del bucket; en la ficha de perfil «Foto guardada en usuarios-archivos» y «Foto eliminada también del almacenamiento». Sin Storage configurado la misma banda muestra el `aviso` del servidor en lugar de un fallo silencioso |
| Panel de usuarios en el navegador (`http://localhost:5173/` con `npm run dev:local`, 12 perfiles demo) | entrar como Soporte TI, abrir *Usuarios*, usar el botón ⋯ | Columna Rol con una insignia por cada rol asignado (el activo lleva `·`) y *Tu cuenta* en la fila propia; el menú ⋯ se pinta sobre `document.body` (`position:fixed`, `z-index:40`) y quedó dentro del viewport incluso en la última fila, donde se voltea hacia arriba; *Asignar roles* abre un diálogo con las cuatro casillas (una por rol, la cuenta siempre marcable) y *Guardar N rol(es)* deshabilitado hasta que el conjunto cambie — al aplicar, la fila muestra las nuevas insignias y la navegación se reconstruye sola; *Eliminar cuenta* abre `role="alertdialog"` con el aviso de trazabilidad y, al confirmar, la tabla baja a 11 con «Jorge Ramírez fue eliminado» mientras sus incidencias siguen mostrando su nombre; en la propia fila el menú omite *Eliminar cuenta* y la ficha del encabezado lista «Roles asignados», registro, último acceso e identificador, cierra con `Esc` y mantiene la sesión |
| Multirol, guardado y quita de archivos en el navegador (`http://localhost:5173/` contra `npm run dev:local`, recorrido completo 27/10/2026) | el admin se asigna Reportante + Técnico, registra una incidencia con imagen, quita esa imagen, la vuelve a elegir y guarda; después autoriza y asigna | *Usuarios → ⋯ (fila propia) → Asignar roles* abre el diálogo con las cuatro casillas (`Reportante`/`Técnico`/`Soporte TI ·`/`Directivo`) y el botón «Guardar 3 rol(es)»; al aplicar aparece «Roles de Soporte TI Demo: Soporte TI, Reportante, Técnico» y **sin cerrar sesión** el menú gana «+ Nueva incidencia» y la cabecera pasa a «Soporte TI · Reportante · Técnico»; `GET /auth/me` devuelve `roles:['soporte_ti','reportante','tecnico']` y el estado **sobrevive a una recarga completa** (el menú se reconstruye desde `/auth/me`). En *Registrar incidencia* cada archivo elegido se lista con su nombre, su bucket (`INCIDENCIAS-EVIDENCIAS`) y su peso junto a un ✕ con `aria-label="Quitar evidencia-prueba.png de las evidencias"`: al pulsarlo la lista queda en 0 renglones y el `<input type=file>` vuelve vacío, así que se puede volver a elegir (comprobado quitando `evidencia-prueba.png` y guardando con `captura-dos.png`). *Guardar y generar folio* responde **201** y lleva al detalle con la banda «Incidencia UTM-2026-0026 registrada en MongoDB con 1 archivo(s) en su bucket»; ahí *Autorizar* → «Solicitud aprobada» y el desplegable «Asignar técnico» asigna a **Ana Cruz**, una cuenta con `roles:['reportante','tecnico']` cuyo rol activo es `reportante`: antes de arreglar `PATCH /incidencias/:id/asignar` ese mismo nombre aparecía en la lista pero el servidor contestaba 400 «Técnico inválido». El historial queda con `creacion → autorizacion → asignacion` firmadas por Soporte TI Demo |

La colección cubre los cuatro roles, la asignación de uno o varios roles (`PATCH /users/:id/rol` y `PUT /users/:id/roles`), aprobación y rechazo con motivo, asignación bloqueada sin autorización, transiciones legales e ilegales, operadores `$inc`/`$set`/`$push`/`$addToSet`/`$pull`, búsqueda textual en español, evidencias y los errores 400/401/403/404/409/413/429. Cada petición trae un test de estado y captura las variables (`id`, `idPendiente`, `tecnicoId`, `artId`, `idUsuario`, `idPropio`). La variable `sufijo` forma parte de los correos de alta: si repites la colección sobre la misma base, súbelo a 2, 3… para evitar los 409 por correo ya registrado.

Cuentas de demostración (contraseña `Demo.2026`, cámbiala con `DEMO_PASSWORD`): `reportante1@demo.utm.edu.mx`, `tecnico1@demo.utm.edu.mx`, `soporte@demo.utm.edu.mx`, `directivo@demo.utm.edu.mx`.

Lo que **no** se pudo verificar aquí: ejecución dentro de la aplicación Postman (las respuestas se obtuvieron con un ejecutor propio en Node que recorre la misma colección) y el recorrido completo de las 91 peticiones tras añadir `GET /edificios`. **MongoDB Atlas sí está verificado para filtros y semilla** (los 61 chequeos de `filtros-atlas.mjs` contra el clúster del equipo, 2026-10-28); lo que sigue pendiente sobre Atlas es la **subida de archivos escribiendo en el clúster**, que exige `npm run dev` con tu IP ya autorizada en *Network Access*, y el contenido del bucket histórico `evidencias`. Para la clasificación de archivos: los tres buckets existen y son privados en el proyecto del equipo, `createSignedUrl` expira en 3600 s contra Supabase y ese contenido sigue legible. Las pruebas locales usan storage simulado (`dev:local`) y una falsificación de `storage` en la suite, que sí ejercitan el bucket elegido, la validación de contenido y la reversa.

Y del despliegue: **la imagen no está construida** — en este equipo no hay Docker ni CLI de Fly/Render/Heroku, y publicar requiere la cuenta del equipo en el host elegido. La topología de servicio único (API sirviendo la web) sí está comprobada en el navegador, como describe la sección 8.

## 10. Estructura

```text
utm-desk/
├── README.md
├── DESIGN.md
├── .gitignore
├── Dockerfile          # imagen de servicio único: API + client/dist
├── .dockerignore       # deja fuera node_modules y cualquier .env
├── client/            # React + Vite (src/App.tsx, src/api.ts, src/roles.ts, PWA)
│   └── vercel.json     # despliegue opcional de solo la web
├── server/
│   ├── index.js       # modelo, RBAC, rutas, agregaciones, índices
│   ├── archivos.js    # clasificación por operación: bucket, contenido real y límites
│   ├── filtros-atlas.mjs  # arnés de filtros contra el clúster real (--arregla, --sembrar)
│   ├── lee-demo.mjs   # convierte datos-demo/*.json (EJSON) a tipos de BSON
│   ├── dev-local.mjs  # API local sin Atlas/Supabase
│   ├── seed-demo.js   # 24 incidencias de demostración
│   ├── excel.js       # exportación con ExcelJS
│   ├── probar-storage.mjs  # subida/firma/lectura/borrado reales contra Supabase
│   ├── exportar-ca-antivirus.ps1  # exporta la CA del antivirus a PEM para NODE_EXTRA_CA_CERTS
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
- La imagen Docker no lleva credenciales: `.dockerignore` excluye `**/.env` y `**/.env.*` del contexto de build, así que ningún secreto queda en una capa consultable con `docker history`; se inyectan con `--env-file` o con el panel del host. El bundle de producción tampoco admite un `VITE_API_URL` de localhost (ver sección 8), para no publicar una web que llama a una máquina local.

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
