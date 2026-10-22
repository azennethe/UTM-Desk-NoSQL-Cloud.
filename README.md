# UTM Desk NoSQL Cloud

Sistema de gestión, resolución y analítica de incidencias del campus universitario.

## 1. Descripción del proyecto

UTM Desk NoSQL Cloud es una propuesta de aplicación web para registrar, administrar, dar seguimiento y analizar incidencias del campus. Su objetivo es centralizar los reportes en tickets con folio, ubicación, prioridad, evidencias y bitácora de seguimiento, para facilitar la atención y conocer el estado y tiempo de resolución de cada incidencia.

El proyecto contempla tres categorías de incidencias:

- **Cómputo y redes** (`computo_redes`)
- **Infraestructura y mantenimiento** (`infraestructura`)
- **Servicios académicos** (`academico`)

## 2. Objetivo

Diseñar una solución en la nube que permita organizar las incidencias del campus mediante una base de datos documental, con información común para todos los reportes y campos específicos según la categoría.

## 3. Arquitectura propuesta

La arquitectura documentada contempla los siguientes componentes:

- **Frontend:** React y TypeScript para la interfaz y los formularios.
- **API:** Node.js y Express para validar solicitudes, sesiones, permisos y datos.
- **Base de datos:** MongoDB Atlas para almacenar incidencias y colecciones auxiliares.
- **Pruebas de API:** Postman para documentar y probar los endpoints.
- **Archivos adjuntos:** Supabase Storage propuesto para almacenar imágenes y PDF; MongoDB conserva sus metadatos y referencias.

Flujo general propuesto:

`Usuario → React → API REST (Express) → MongoDB Atlas`

Los archivos multimedia no se guardan directamente dentro del documento de incidencia; se propone conservar en MongoDB la referencia y los metadatos correspondientes.

## 4. Modelo de datos propuesto

El inventario de diseño contempla **cuatro colecciones**:

| Colección | Tipo | Propósito |
|---|---|---|
| `incidencias_campus` | Principal | Almacena tickets, campos comunes, detalle específico por categoría, etiquetas, historial y metadatos de evidencias. |
| `usuarios` | Auxiliar | Almacena datos de cuenta, correo institucional, rol y hash de contraseña. |
| `contadores` | Auxiliar | Puede generar folios consecutivos mediante operaciones atómicas con `$inc`. |
| `auditoria` | Auxiliar | Registra acciones administrativas para conservar la trazabilidad. |

Este inventario describe el **diseño propuesto**; no confirma por sí mismo que todas las colecciones estén creadas en MongoDB Atlas. La colección `contadores` depende de la decisión final sobre el mecanismo de generación de folios.

### Campos y estructuras de las incidencias

La colección principal contempla campos comunes como:

- `folio`, `titulo` y `descripcion`
- `categoria`, `prioridad` y `estado`
- `autorizacion`
- `reportante` y `ubicacion`
- `detalle_especifico`
- `tags`
- `historial_seguimiento`
- `evidencias_adjuntas`
- `horas_invertidas` y `fecha_creacion`

El subdocumento `detalle_especifico` varía según la categoría, evitando agregar campos irrelevantes a todos los tipos de reporte.

## 5. Roles y acceso

El diseño contempla perfiles y permisos para limitar las acciones según el tipo de usuario. La API debe validar los permisos en cada solicitud; no basta con ocultar botones en la interfaz. Las contraseñas no deben almacenarse en texto legible, sino mediante hashes.

La política institucional de altas y correos, así como ciertos detalles de autenticación y autorización, deben confirmarse durante el desarrollo.

## 6. Estado del proyecto

Este repositorio corresponde al avance de diseño de la **Fase 1**. La documentación presenta la arquitectura, el inventario de colecciones, los requisitos y ejemplos de modelado JSON/BSON.

**Importante:** los elementos descritos como propuestos no deben interpretarse como funcionalidades ya implementadas o probadas. La creación y validación de colecciones en Atlas, índices, validadores, endpoints, datos de prueba y pruebas de API deben marcarse como completados únicamente cuando se hayan ejecutado y verificado.

## 7. Estructura sugerida del repositorio

La estructura puede ampliarse conforme se incorporen archivos reales del proyecto:

```text
UTM-Desk-NoSQL-Cloud/
├── README.md
├── docs/
│   └── documentacion-fase-1.pdf
├── database/
│   ├── schemas/
│   ├── indexes/
│   └── seed/
├── api/
└── frontend/
```

Las carpetas `database/`, `api/` y `frontend/` son una organización sugerida; deben incluirse solo cuando existan los archivos correspondientes. No subas contraseñas, claves privadas, tokens ni archivos `.env` con secretos.


## 8. Equipo

- **Proyecto:** UTM Desk NoSQL Cloud
- **Asignatura:** Bases de Datos en la Nube
- **Equipo:** 3
- **Integrantes:** Adrian Oropeza, Carlos Sanches, Cesar Abdiel, Melania Moo
- **Docente:** Lizandro Israel Reyes Castillo

