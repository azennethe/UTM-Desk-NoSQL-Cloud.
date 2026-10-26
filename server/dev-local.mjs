// Arranque LOCAL SIN MongoDB Atlas ni Supabase, para probar la API y la interfaz
// en tu máquina: base desechable en memoria + datos de demostración + API en 4100.
//   node dev-local.mjs
// Ninguna escritura llega a Atlas ni a Supabase; el storage es un mapa en RAM.
import 'dotenv/config';
import http from 'node:http';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { seed } from './seed-demo.js';
import { createApp, User, bootstrap } from './index.js';

const PASS = process.env.DEMO_PASSWORD || 'Demo.2026';
// DEV_PORT evita chocar con el PORT del .env, que apunta a la API real
const PORT = Number(process.env.DEV_PORT || 4100);
delete process.env.PORT;

const mem = await MongoMemoryServer.create();
process.env.MONGODB_URI = mem.getUri('UTM_Desk_Demo');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
// ADMIN_EMAIL/ADMIN_PASSWORD del .env también se respetan aquí: bootstrap() crea o
// asciende esa cuenta como Soporte TI para poder probar el panel de administración.
if (!process.env.AUTH_RATE) process.env.AUTH_RATE = '60';
console.log('🧪 Base en memoria (desechable):', process.env.MONGODB_URI);

// Solo para este arranque de desarrollo: guarda los bytes en RAM y los sirve por su propio
// puerto, imitando la URL firmada de un bucket privado. No demuestra la integración con
// Supabase; eso requiere credenciales reales.
const blob = new Map();
const PUERTO_BLOB = PORT + 1;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' };
const firmado = path => `http://localhost:${PUERTO_BLOB}/` + encodeURIComponent(path);
const storage = {
    storage: {
        from: () => ({
            upload: async (path, buf) => { blob.set(path, Buffer.from(buf)); return { error: null }; },
            createSignedUrl: async path => ({ data: { signedUrl: firmado(path) } }),
        }),
    },
};

// createApp() cierra con un 404 global, así que las evidencias no pueden montarse en ese mismo servidor.
http.createServer((q, s) => {
    const b = blob.get(decodeURIComponent((q.url || '/').slice(1).split('?')[0]));
    if (!b) { s.writeHead(404, { 'Content-Type': 'application/json' }); return s.end('{"error":"evidencia no encontrada"}'); }
    s.writeHead(200, { 'Content-Type': MIME[String(q.url).split('.').pop()] || 'application/octet-stream' });
    s.end(b);
}).listen(PUERTO_BLOB);

await bootstrap({ uri: process.env.MONGODB_URI, ttlDias: 60 });

const hash = await bcrypt.hash(PASS, 10);
for (const [nombre, email, rol] of [
    ['Soporte TI Demo', 'soporte@demo.utm.edu.mx', 'soporte_ti'],
]) {
    if (!(await User.exists({ email }))) await User.create({ nombre, email, password: hash, rol });
}

const r = await seed({
    aplicar: true,
    uri: process.env.MONGODB_URI,
    storage,
    nombreStorage: 'storage simulado de desarrollo',
    desconectar: false,
});

const app = createApp({
    storage,
    corsOrigins: (process.env.DEV_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174')
        .split(',').map(s => s.trim()),
});
app.listen(PORT, () => {
    console.log(`✅ API local lista en http://localhost:${PORT}/api`);
    console.log(`   Evidencias de desarrollo en http://localhost:${PUERTO_BLOB} (RAM, sin Supabase)`);
    console.log(`   ${r.total} incidencias demo, ${r.conEv} con evidencias, ${r.subidas} archivos en RAM`);
    console.log(`   Cuentas (contraseña ${PASS}): soporte@demo.utm.edu.mx, tecnico1@demo.utm.edu.mx,`);
    console.log('   reportante1@demo.utm.edu.mx, directivo@demo.utm.edu.mx');
    console.log(`   Client: VITE_API_URL=http://localhost:${PORT}/api`);
});

process.on('SIGINT', async () => {
    await mongoose.disconnect();
    await mem.stop();
    process.exit(0);
});
