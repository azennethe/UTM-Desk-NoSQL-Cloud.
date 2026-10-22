# UTM Desk NoSQL Cloud
## Preparación
1. **MongoDB Atlas**: crea un clúster y copia la cadena de conexión (permite tu IP en Network Access).
2. **Supabase**: crea un bucket **privado** llamado `evidencias` y copia la URL y la *service_role key* (solo en el backend).
3. `server/`: `cp .env.example .env`, completa los valores, luego `npm i && npm run dev`. Se crea el admin inicial (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), los índices (texto, etiquetas, TTL de 60 días) y 4 artículos FAQ.
4. `client/`: `cp .env.example .env`, luego `npm i && npm run dev` → http://localhost:5173
## PWA / offline
El service worker solo se registra en producción: `npm run build && npm run preview`. Sin conexión puedes ver datos en caché y guardar borradores; se envían solos al reconectar (cada 30 s o con "Forzar sincronización").
## Roles
usuario (se registra solo) · técnico y admin (los crea el admin en la pantalla Usuarios).
## Postman
Importa `postman/UTM-Desk.postman_collection.json` y ejecuta "Login admin" primero (guarda el token).
## Ubicaciones del mapa
Las coordenadas de edificios están en `COORD` dentro de `client/src/App.tsx` (aproximadas, ajústalas).
