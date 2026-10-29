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
// El proyecto simulado de esta demo usa los tres nombres de la consigna. Sin esto, el
// SUPABASE_BUCKET histórico del .env heredaría el bucket de las evidencias y la
// clasificación quedaría invisible en pantalla.
process.env.SUPABASE_BUCKET_EVIDENCIAS ||= 'incidencias-evidencias';
process.env.SUPABASE_BUCKET_DOCUMENTOS ||= 'incidencias-documentos';
process.env.SUPABASE_BUCKET_PERFILES ||= 'usuarios-archivos';
console.log('🧪 Base en memoria (desechable):', process.env.MONGODB_URI);

// Solo para este arranque de desarrollo: guarda los bytes en RAM por bucket y los sirve por
// su propio puerto, imitando la URL firmada de un bucket privado. No demuestra la integración
// con Supabase; eso requiere credenciales reales.
// El mapa de buckets es una SIMULACIÓN: solo existen los tres nombres que pide la consigna
// (y el histórico), así que un archivo enviado a un bucket inexistente falla igual que arriba.
import { BUCKETS, nombreBucket, resumenBuckets } from './archivos.js';
const clave = new Map(); // `${bucket}/${ruta}` -> { buf, mime }
const permitidos = new Set([...Object.keys(BUCKETS).map(nombreBucket), process.env.SUPABASE_BUCKET || 'evidencias']);
const PUERTO_BLOB = PORT + 1;
const MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    pdf: 'application/pdf', txt: 'text/plain; charset=utf-8',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const firmado = (bucket, ruta) => `http://localhost:${PUERTO_BLOB}/` + encodeURIComponent(`${bucket}/${ruta}`);
const storage = {
    storage: {
        from: bucket => {
            const conocido = permitidos.has(bucket);
            return {
                upload: async (ruta, buf, o) => {
                    if (!conocido) return { error: { message: `bucket «${bucket}» no existe en el proyecto simulado` } };
                    clave.set(`${bucket}/${ruta}`, { buf: Buffer.from(buf), mime: o?.contentType });
                    console.log(`   🪣 ${bucket}/${ruta}`);
                    return { error: null };
                },
                createSignedUrl: async ruta => ({ data: { signedUrl: clave.has(`${bucket}/${ruta}`) ? firmado(bucket, ruta) : null } }),
                remove: async rutas => { for (const r of [].concat(rutas || [])) clave.delete(`${bucket}/${r}`); return { data: rutas, error: null }; },
            };
        },
    },
};

// createApp() cierra con un 404 global, así que las evidencias no pueden montarse en ese mismo servidor.
http.createServer((q, s) => {
    const v = clave.get(decodeURIComponent((q.url || '/').slice(1).split('?')[0]));
    if (!v) { s.writeHead(404, { 'Content-Type': 'application/json' }); return s.end('{"error":"archivo no encontrado"}'); }
    s.writeHead(200, { 'Content-Type': v.mime || MIME[String(q.url).split('.').pop()] || 'application/octet-stream' });
    s.end(v.buf);
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
    console.log('   ⚠️  Base EN MEMORIA: lo que crees aquí NO se guarda en MongoDB Atlas');
    console.log('      (se pierde al reiniciar). Para Atlas usa npm run dev en el puerto 4000.');
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
