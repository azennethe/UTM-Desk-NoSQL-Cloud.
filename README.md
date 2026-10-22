# UTM Desk NoSQL Cloud

Sistema de gestión, resolución y analítica de incidencias del campus universitario.

## 1. Descripción del proyecto

UTM Desk NoSQL Cloud es una aplicación web diseñada para registrar, administrar, dar seguimiento y analizar incidencias del campus universitario. Su objetivo es centralizar los reportes mediante tickets con folio, ubicación, prioridad, evidencias y bitácora de seguimiento, facilitando la atención y el análisis del estado y tiempo de resolución de cada incidencia.

El proyecto contempla tres categorías de incidencias:

- **Cómputo y redes** (`computo_redes`)
- **Infraestructura y mantenimiento** (`infraestructura`)
- **Servicios académicos** (`academico`)

## 2. Objetivo

Diseñar una solución en la nube que permita organizar las incidencias del campus mediante una base de datos documental, con información común para todos los reportes y campos específicos según la categoría.

## 3. Arquitectura del proyecto

La arquitectura utiliza o contempla los siguientes componentes, según el estado de implementación de cada módulo:

- **Frontend:** React y TypeScript para la interfaz y los formularios.
- **API:** Node.js y Express para gestionar solicitudes, sesiones, permisos y datos.
- **Base de datos:** MongoDB Atlas para almacenar incidencias y colecciones auxiliares.
- **Almacenamiento de archivos:** Supabase Storage para evidencias, según la configuración del proyecto.
- **Pruebas de API:** Postman para documentar y probar los endpoints.

Flujo general:

`Usuario → React → API REST (Express) → MongoDB Atlas`

Los archivos multimedia se almacenan por separado cuando se utiliza almacenamiento externo. MongoDB conserva sus referencias y metadatos.

## 4. Modelo de datos

El diseño contempla cuatro colecciones principales:

| Colección | Propósito |
|---|---|
| `incidencias_campus` | Almacena tickets, campos comunes, detalles por categoría, etiquetas, historial y metadatos de evidencias. |
| `usuarios` | Almacena datos de cuenta, correo, rol y hash de contraseña. |
| `contadores` | Puede generar folios consecutivos mediante operaciones atómicas con `$inc`. |
| `auditoria` | Registra acciones administrativas para conservar la trazabilidad. |

La existencia y configuración efectiva de cada colección debe verificarse en MongoDB Atlas.

### Campos y estructuras de las incidencias

La colección principal contempla campos como:

- `folio`, `titulo` y `descripcion`
- `categoria`, `prioridad` y `estado`
- `autorizacion`
- `reportante` y `ubicacion`
- `detalle_especifico`
- `tags`
- `historial_seguimiento`
- `evidencias_adjuntas`
- `horas_invertidas` y `fecha_creacion`

El subdocumento `detalle_especifico` varía según la categoría para evitar almacenar campos irrelevantes en todos los reportes.

## 5. Preparación e instalación

### Requisitos

- Node.js y npm.
- Una cuenta de MongoDB Atlas con un clúster configurado.
- Una cuenta de Supabase si se utiliza para almacenar evidencias.
- Git para gestionar el código fuente.

### Configurar MongoDB Atlas

1. Crea un clúster en MongoDB Atlas.
2. Crea o selecciona la base de datos del proyecto.
3. Configura un usuario de base de datos.
4. Permite la conexión desde tu dirección IP en Network Access.
5. Copia la cadena de conexión y guárdala en las variables de entorno del backend.

### Configurar Supabase

Si el proyecto utiliza Supabase Storage:

1. Crea un proyecto en Supabase.
2. Crea el bucket `evidencias` con acceso privado.
3. Configura las credenciales necesarias en el backend.
4. Mantén la clave `service_role` exclusivamente en el servidor. Nunca la expongas en el frontend ni la subas a GitHub.

### Instalar y ejecutar el backend

Desde la terminal, entra a la carpeta `server`:

```bash
cd server
```

Copia `.env.example` a `.env`, si ese archivo de ejemplo existe, y completa las variables necesarias. Después ejecuta:

```bash
npm install
npm run dev
```

Si el proyecto incluye inicialización automática, revisa los registros del servidor para confirmar la creación del administrador inicial, los índices y los datos FAQ.

### Instalar y ejecutar el frontend

Abre otra terminal y entra a la carpeta `client`:

```bash
cd client
```

Configura las variables de entorno a partir de `.env.example`, si está disponible, y ejecuta:

```bash
npm install
npm run dev
```

Vite normalmente muestra la dirección local en la terminal; en la configuración predeterminada suele ser:

`http://localhost:5173`

## 6. Aplicación web progresiva (PWA) y modo offline

El proyecto contempla funcionamiento PWA y soporte limitado sin conexión.

Para probar la versión de producción, desde la carpeta del frontend ejecuta:

```bash
npm run build
npm run preview
```

Si el service worker y la sincronización están implementados y configurados, los datos almacenados en caché pueden consultarse sin conexión y los borradores pueden sincronizarse al recuperar la conectividad.

El comportamiento real depende de la implementación y debe verificarse durante las pruebas.

## 7. Roles y permisos

El sistema contempla los siguientes roles:

- **Usuario:** registra incidencias y consulta su seguimiento según sus permisos.
- **Técnico:** atiende incidencias y actualiza su progreso, de acuerdo con los permisos implementados.
- **Administrador:** gestiona usuarios y las operaciones administrativas autorizadas.

En la configuración prevista, los usuarios pueden registrarse y el administrador puede crear cuentas de técnicos y otros administradores desde la pantalla de usuarios.

La API debe validar los permisos en cada solicitud. Las contraseñas deben almacenarse mediante hashes seguros, nunca en texto legible.

## 8. Pruebas con Postman

El repositorio incluye una colección de Postman para probar los endpoints de la API.

1. Abre Postman.
2. Importa `postman/UTM-Desk.postman_collection.json`.
3. Configura la URL base y las variables necesarias.
4. Ejecuta primero la solicitud de inicio de sesión del administrador, si está incluida en la colección.
5. Comprueba las solicitudes y sus respuestas.

Los nombres de las solicitudes y los requisitos de autenticación deben coincidir con la colección real del proyecto.

## 9. Ubicaciones del mapa

Si el mapa está implementado en el frontend, las coordenadas de los edificios pueden encontrarse en la constante `COORD` de `client/src/App.tsx`.

Las coordenadas deben verificarse y ajustarse según las ubicaciones reales del campus.

## 10. Estructura del repositorio

La estructura actual incluye las carpetas del cliente, el servidor y las pruebas de API:

```text
utm-desk/
├── README.md
├── DESIGN.md
├── client/
├── server/
└── postman/
```

La estructura puede ampliarse con carpetas de documentación, esquemas de base de datos, índices y datos de prueba conforme se incorporen los archivos correspondientes.

## 11. Estado del proyecto

Este repositorio corresponde al desarrollo de UTM Desk NoSQL Cloud y su documentación académica.

Las funcionalidades, colecciones, índices, validadores, endpoints y pruebas deben considerarse completados únicamente cuando se hayan ejecutado y verificado. Los elementos descritos como previstos o contemplados no implican que ya estén implementados.

## 12. Equipo

- **Proyecto:** UTM Desk NoSQL Cloud
- **Asignatura:** Bases de Datos en la Nube
- **Equipo:** 3
- **Integrantes:** Adrian Oropeza, Carlos Sanches, Cesar Abdiel y Melania Moo
- **Docente:** Lizandro Israel Reyes Castillo

## 13. Seguridad

- No subas archivos `.env` con credenciales.
- No publiques contraseñas, claves privadas ni tokens.
- Mantén las claves privilegiadas exclusivamente en el backend.
- Usa permisos mínimos necesarios para las cuentas de base de datos y servicios externos.
- Comprueba que `node_modules/` esté excluido del repositorio mediante `.gitignore`.
