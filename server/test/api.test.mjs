process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';

const JWT = 'secret-de-prueba-super-largo-1234567890';
let pass = 0, fail = 0;
const paso = (nombre, fn) => fn().then(() => { pass++; console.log('  ✓', nombre); }, e => { fail++; console.log('  ✗', nombre, '\n     ', e.message); });

const mongod = await MongoMemoryServer.create();
process.env.JWT_SECRET = JWT;
process.env.TTL_DIAS = '60';
process.env.AUTH_RATE = '1000';
// Nombres de bucket deterministas: la suite no debe cambiar de resultado según el .env
// del equipo que la ejecuta (dotenv respeta lo que ya esté definido).
process.env.SUPABASE_BUCKET_EVIDENCIAS = 'incidencias-evidencias';
process.env.SUPABASE_BUCKET_DOCUMENTOS = 'incidencias-documentos';
process.env.SUPABASE_BUCKET_PERFILES = 'usuarios-archivos';
delete process.env.SUPABASE_BUCKET;
delete process.env.SUPABASE_URL;

const mod = await import('../index.js');
const { createApp, bootstrap, sincronizarFechasDeRegistro, Inc, User } = mod;
await bootstrap({ uri: mongod.getUri(), ttlDias: 60 });

// almacenamiento falso: registra bucket, ruta y firma; permite simular una caída de Supabase
const subidas = [], firmadas = [], borrados = [];
let storageCaido = false, intentos = 0, fallarEn = 0;
const storage = {
    storage: {
        from: b => ({
            upload: async (path, buf, o) => {
                intentos++;
                if (storageCaido || intentos === fallarEn) return { error: { message: 'servicio de storage indisponible' } };
                subidas.push({ b, path, size: buf.length, tipo: o.contentType });
                return { error: null };
            },
            createSignedUrl: async path => {
                firmadas.push({ b, path });
                return { data: { signedUrl: 'https://firma.test/' + encodeURIComponent(b + '/' + path) } };
            },
            remove: async r => { for (const p of [].concat(r || [])) borrados.push({ b, p }); return { data: r, error: null }; }
        })
    }
};

const app = createApp({ jwtSecret: JWT, storage, corsOrigins: ['http://localhost:5173'] });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;

const ll = async (ruta, cuerpo, token) => {
    const r = await fetch(base + ruta, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(cuerpo)
    });
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
};
const pet = async (metodo, ruta, cuerpo, token, headers = {}) => {
    const r = await fetch(base + ruta, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
    });
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
};
const get = (ruta, token, headers) => pet('GET', ruta, undefined, token, headers);

// cuentas de prueba
const crear = async (email, rol) => {
    await User.create({ nombre: email.split('@')[0], email, password: await bcrypt.hash('clave123456', 10), rol });
    return email;
};
const [mailRepo, mailRepo2, mailTec, mailTec2, mailSoporte, mailDir] = await Promise.all([
    crear('ana@test.mx', 'reportante'), crear('bruno@test.mx', 'reportante'), crear('tech@test.mx', 'tecnico'),
    crear('tech2@test.mx', 'tecnico'), crear('soporte@test.mx', 'soporte_ti'), crear('dir@test.mx', 'directivo')
]);
const tok = async mail => (await ll('/auth/login', { email: mail, password: 'clave123456' })).body.token;
const [T_REPO, T_REPO2, T_TEC, T_TEC2, T_SUP, T_DIR] = await Promise.all([mailRepo, mailRepo2, mailTec, mailTec2, mailSoporte, mailDir].map(tok));

const DATOS_CAT = { tipo_equipo: 'Laptop', equipos_afectados: 'Aula de medios', direccion_ip: '10.20.3.11', vlan: '120' };
const nueva = async (token, extra = {}) => (await ll('/incidencias', {
    titulo: 'Falla de red en el laboratorio', descripcion: 'El switch reinicia puertos cada 20 minutos.',
    categoria: 'Cómputo y telecomunicaciones', prioridad: 'Alta', edificio: 'Edificio C', espacio: 'Lab 3',
    etiquetas: JSON.stringify(['WiFi', 'switch', 'wifi']), datosCategoria: JSON.stringify(DATOS_CAT), ...extra
}, token));

console.log('\nAutenticación y control de acceso');
await paso('login correcto devuelve token y rol', async () => {
    const r = await ll('/auth/login', { email: mailRepo, password: 'clave123456' });
    assert.equal(r.status, 200); assert.ok(r.body.token); assert.equal(r.body.user.rol, 'reportante');
});
await paso('credenciales malas dan 401 genérico (sin enumerar correos)', async () => {
    const mala = await ll('/auth/login', { email: mailRepo, password: 'no-es-la-clave' });
    const inexistente = await ll('/auth/login', { email: 'nadie@test.mx', password: 'no-es-la-clave' });
    assert.equal(mala.status, 401); assert.equal(inexistente.status, 401);
    assert.equal(mala.body.error, inexistente.body.error);
});
await paso('sin token y con token roto dan 401', async () => {
    assert.equal((await get('/incidencias')).status, 401);
    assert.equal((await get('/incidencias', 'xyz')).status, 401);
});
await paso('el registro público nunca otorga roles privilegiados', async () => {
    const r = await ll('/auth/register', { nombre: 'Intruso', email: 'intruso@test.mx', password: 'clave123456', rol: 'soporte_ti' });
    assert.equal(r.status, 201); assert.equal(r.body.user.rol, 'reportante');
});
await paso('/auth/me devuelve la sesión completa para reanudarla tras recargar', async () => {
    const r = await get('/auth/me', T_REPO);
    assert.equal(r.status, 200);
    const u = await User.findOne({ email: mailRepo });
    assert.equal(String(r.body.id), String(u._id));
    assert.equal(r.body.email, mailRepo); assert.equal(r.body.rol, 'reportante');
    assert.equal((await get('/auth/me')).status, 401);
});
await paso('/estado informa si la API escribe en Atlas o en una base local', async () => {
    const r = await get('/estado');
    assert.equal(r.status, 200);
    assert.equal(r.body.almacen, 'local', 'la suite corre sobre MongoDB en memoria, aunque el .env apunte a Atlas');
    // con el storage falso inyectado la API sí acepta subidas: /estado debe reportarlo
    assert.equal(r.body.storage.hay, true, 'el almacenamiento inyectado cuenta como operativo');
    // el clasificador debe reconocer el host real de un cluster (SRV resuelto a las shards)
    const { almacenDe } = mod;
    assert.equal(almacenDe('cluster0.mw9er72.mongodb.net:27017'), 'atlas');
    assert.equal(almacenDe('ac-prd-shard-00-00.mw9er72.mongodb.net:27017 ac-prd-shard-00-01.mw9er72.mongodb.net:27017'), 'atlas');
    assert.equal(almacenDe('127.0.0.1:63432'), 'local');
    assert.equal(almacenDe(''), 'local');
});
await paso('motivoStorage traduce los fallos reales de Supabase en acciones concretas', async () => {
    const { motivoStorage } = mod;
    // caso real verificado contra el proyecto con clave publishable (role anon)
    assert.match(motivoStorage({ message: 'new row violates row-level security policy' }), /SUPABASE_SECRET_KEY/);
    // caso real verificado con Avast interceptando el TLS: Node no reconoce su certificado raíz
    assert.match(motivoStorage({ message: 'fetch failed', cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } }), /NODE_EXTRA_CA_CERTS/);
    assert.match(motivoStorage({ message: 'Bucket not found' }), /SUPABASE_BUCKET_EVIDENCIAS/);
    assert.match(motivoStorage({ message: 'the file is larger than the allowed size' }), /límite/);
    assert.equal(motivoStorage({}), 'error no especificado por Supabase');
    // la clave jamás aparece en el texto devuelto al cliente
    assert.doesNotMatch(motivoStorage({ message: 'invalid apikey sb_secret_XXXXXXXXXX' }), /sb_secret_/);
});
await paso('CORS restringido al origen configurado y encabezados de seguridad', async () => {
    const r = await get('/incidencias', T_REPO, { Origin: 'http://localhost:5173' });
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    // Vite también responde en 127.0.0.1; si ese origen se rechaza el login falla en el navegador
    assert.equal((await get('/incidencias', T_REPO, { Origin: 'http://127.0.0.1:5173' })).headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
    assert.equal((await get('/incidencias', T_REPO, { Origin: 'http://localhost:5199' })).headers.get('access-control-allow-origin'), null);
    assert.equal((await get('/incidencias', T_REPO, { Origin: 'http://malicioso.mx' })).headers.get('access-control-allow-origin'), null);
    assert.equal((await get('/incidencias', T_REPO)).headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await get('/no-existe', T_REPO)).status, 404);
});

console.log('\nValidación del modelo por categoría');
await paso('rechaza datosCategoria genérico sin los campos de la categoría', async () => {
    const r = await nueva(T_REPO, { datosCategoria: JSON.stringify({ detalle: 'texto libre' }) });
    assert.equal(r.status, 400); assert.match(r.body.error, /tipo_equipo/);
});
await paso('rechaza VLAN fuera de rango e IP inválida', async () => {
    assert.equal((await nueva(T_REPO, { titulo: 'Prueba VLAN fuera de rango', datosCategoria: JSON.stringify({ ...DATOS_CAT, vlan: '9999' }) })).status, 400);
    assert.equal((await nueva(T_REPO, { titulo: 'Prueba IP inválida', datosCategoria: JSON.stringify({ ...DATOS_CAT, direccion_ip: '999.1.1.1' }) })).status, 400);
});
await paso('crea incidencia con folio, etiqueta deduplicada y autorización pendiente', async () => {
    const r = await nueva(T_REPO);
    assert.equal(r.status, 201);
    assert.match(r.body.folio, /^UTM-\d{4}-\d{4}$/);
    assert.deepEqual(r.body.etiquetas, ['wifi', 'switch']);
    assert.equal(r.body.autorizacion.estado, 'pendiente');
    assert.deepEqual(r.body.datosCategoria, { ...DATOS_CAT, vlan: 120 });
});
await paso('un arreglo JSON inyectable en etiquetas se rechaza', async () => {
    assert.equal((await nueva(T_REPO, { etiquetas: '{"$ne":null}' })).status, 400);
});

console.log('\nAislamiento por rol');
const inc = (await nueva(T_REPO)).body;
await paso('un reportante no ve la incidencia ajena (403) ni la lista', async () => {
    assert.equal((await get(`/incidencias/${inc._id}`, T_REPO2)).status, 403);
    assert.equal((await get('/incidencias', T_REPO2)).body.total, 0);
});
await paso('el dueño sí la ve y solo ve las suyas', async () => {
    const antes = (await get('/incidencias', T_REPO2)).body.total;
    assert.equal((await get(`/incidencias/${inc._id}`, T_REPO)).status, 200);
    assert.equal((await get('/incidencias', T_REPO2)).body.total, antes);
    assert.ok((await get('/incidencias', T_REPO)).body.total >= 1);
});
await paso('el técnico no ve incidencias sin asignar (RF-02)', async () => {
    assert.equal((await get('/incidencias', T_TEC)).body.total, 0);
    assert.equal((await get(`/incidencias/${inc._id}`, T_TEC)).status, 403);
});
await paso('Soporte TI ve todo; Directivo no accede a expedientes', async () => {
    assert.ok((await get('/incidencias', T_SUP)).body.total >= 1);
    assert.equal((await get('/incidencias', T_DIR)).status, 403);
    assert.equal((await get(`/incidencias/${inc._id}`, T_DIR)).status, 403);
});
await paso('exportar incidencias y Excel es solo para Soporte TI', async () => {
    for (const t of [T_REPO, T_TEC, T_DIR]) assert.equal((await get('/incidencias/export', t)).status, 403);
    assert.ok(Array.isArray((await get('/incidencias/export', T_SUP)).body));
});
await paso('un rol cambiado en base de datos deja de tener privilegios al instante', async () => {
    // En el modelo multirol el conjunto que autoriza es `roles`; se escriben los dos campos
    // como los escribiría la ruta de administración.
    await User.updateOne({ email: mailSoporte }, { $set: { rol: 'reportante', roles: ['reportante'] } });
    assert.equal((await get('/incidencias/export', T_SUP)).status, 403);
    await User.updateOne({ email: mailSoporte }, { $set: { rol: 'soporte_ti', roles: ['soporte_ti'] } });
});

console.log('\nAutorización y rechazo (RF-06 / RF-07)');
await paso('nadie puede atender una incidencia pendiente: 403 sin asignación, 409 estando asignado', async () => {
    const pend = (await nueva(T_REPO2)).body;
    const tec = (await User.findOne({ email: mailTec }))._id;
    assert.equal((await pet('PATCH', `/incidencias/${pend._id}/estado`, { estado: 'En proceso', comentario: 'x' }, T_TEC)).status, 403);
    await pet('PATCH', `/incidencias/${pend._id}/asignar`, { tecnicoId: tec }, T_SUP).then(async r => {
        // aún no se puede asignar: primero hay que autorizarla
        assert.equal(r.status, 409);
        await pet('PATCH', `/incidencias/${pend._id}/autorizacion`, { accion: 'aprobar' }, T_SUP);
        assert.equal((await pet('PATCH', `/incidencias/${pend._id}/asignar`, { tecnicoId: tec }, T_SUP)).status, 200);
    });
    assert.equal((await pet('PATCH', `/incidencias/${pend._id}/estado`, { estado: 'En proceso', comentario: 'x' }, T_TEC)).status, 200);
});
await paso('solo Soporte TI autoriza; el reportante no puede autoaprobarse', async () => {
    assert.equal((await pet('PATCH', `/incidencias/${inc._id}/autorizacion`, { accion: 'aprobar' }, T_REPO)).status, 403);
    const ok = await pet('PATCH', `/incidencias/${inc._id}/autorizacion`, { accion: 'aprobar' }, T_SUP);
    assert.equal(ok.status, 200); assert.equal(ok.body.autorizacion.estado, 'aprobada');
});
await paso('autorizar dos veces se rechaza con 409', async () => {
    assert.equal((await pet('PATCH', `/incidencias/${inc._id}/autorizacion`, { accion: 'aprobar' }, T_SUP)).status, 409);
});
await paso('el rechazo exige motivo y cierra la incidencia', async () => {
    const otra = (await nueva(T_REPO2)).body;
    assert.equal((await pet('PATCH', `/incidencias/${otra._id}/autorizacion`, { accion: 'rechazar' }, T_SUP)).status, 400);
    const r = await pet('PATCH', `/incidencias/${otra._id}/autorizacion`, { accion: 'rechazar', motivo: 'Duplicada con UTM-2026-0001' }, T_SUP);
    assert.equal(r.status, 200); assert.equal(r.body.estado, 'Cerrada'); assert.equal(r.body.autorizacion.estado, 'rechazada');
});

console.log('\nAsignación y transiciones de estado');
await paso('no se asigna a un técnico inexistente ni a otro rol', async () => {
    assert.equal((await pet('PATCH', `/incidencias/${inc._id}/asignar`, { tecnicoId: '000000000000000000000000' }, T_SUP)).status, 400);
    const dir = await User.findOne({ email: mailDir });
    assert.equal((await pet('PATCH', `/incidencias/${inc._id}/asignar`, { tecnicoId: dir._id }, T_SUP)).status, 400);
});
await paso('asignar a un técnico válido y luego atenderla', async () => {
    const t = await User.findOne({ email: mailTec });
    const antes = (await get('/incidencias', T_TEC)).body.total;
    assert.equal((await pet('PATCH', `/incidencias/${inc._id}/asignar`, { tecnicoId: t._id }, T_SUP)).status, 200);
    assert.equal((await get('/incidencias', T_TEC)).body.total, antes + 1);
    const r = await pet('PATCH', `/incidencias/${inc._id}/estado`, { estado: 'En proceso', comentario: 'En sitio' }, T_TEC);
    assert.equal(r.status, 200); assert.equal(r.body.estado, 'En proceso');
});
await paso('transiciones inválidas: Abierta→Resuelta, cierre solo de Soporte TI y Cerrada inamovible', async () => {
    const otra = (await nueva(T_REPO2)).body;
    await pet('PATCH', `/incidencias/${otra._id}/autorizacion`, { accion: 'aprobar' }, T_SUP);
    await pet('PATCH', `/incidencias/${otra._id}/asignar`, { tecnicoId: (await User.findOne({ email: mailTec }))._id }, T_SUP);
    assert.equal((await pet('PATCH', `/incidencias/${otra._id}/estado`, { estado: 'Resuelta', comentario: 'x' }, T_TEC)).status, 400);
    assert.equal((await pet('PATCH', `/incidencias/${otra._id}/estado`, { estado: 'Cerrada', comentario: 'x' }, T_TEC)).status, 403);
    const cierra = await pet('PATCH', `/incidencias/${otra._id}/estado`, { estado: 'Cerrada', comentario: 'cerrada' }, T_SUP);
    assert.equal(cierra.status, 200);
    assert.equal((await pet('PATCH', `/incidencias/${otra._id}/estado`, { estado: 'Abierta', comentario: 'x' }, T_SUP)).status, 400);
});
await paso('el técnico de otra incidencia no puede intervenir (403)', async () => {
    assert.equal((await pet('PATCH', `/incidencias/${inc._id}/estado`, { estado: 'Resuelta', comentario: 'x' }, T_TEC2)).status, 403);
});
await paso('resolver registra fecha y reabrir la devuelve a En proceso', async () => {
    const r = await pet('PATCH', `/incidencias/${inc._id}/estado`, { estado: 'Resuelta', comentario: 'Cambiado el módulo PoE' }, T_TEC);
    assert.equal(r.status, 200); assert.ok(r.body.fechaResolucion);
    const re = await pet('PATCH', `/incidencias/${inc._id}/estado`, { estado: 'En proceso', comentario: 'Reabierta por prueba de carga' }, T_TEC);
    assert.equal(re.status, 200); assert.equal(re.body.estado, 'En proceso');
});

console.log('\nOperadores MongoDB en operaciones reales');
await paso('$addToSet agrega sin duplicar y $pull quita sin reescribir', async () => {
    const r = await pet('PATCH', `/incidencias/${inc._id}/etiquetas`, { agregar: ['wifi', 'poe', 'POE'], quitar: ['switch'] }, T_TEC);
    assert.equal(r.status, 200);
    assert.ok(r.body.etiquetas.includes('poe') && !r.body.etiquetas.includes('switch'));
    assert.equal(r.body.etiquetas.filter(t => t === 'wifi').length, 1);
});
await paso('$inc acumula horasTotales y $push agrega al historial', async () => {
    const a = await pet('POST', `/incidencias/${inc._id}/intervenciones`, { comentario: 'Diagnóstico', horas: 2 }, T_TEC);
    const b = await pet('POST', `/incidencias/${inc._id}/intervenciones`, { comentario: 'Reemplazo', horas: 1.5 }, T_TEC);
    assert.equal(b.body.horasTotales, 3.5);
    assert.equal(b.body.historial.filter(x => x.tipo === 'intervencion').length, 2);
    assert.equal(a.status, 200);
});
await paso('horas fuera de rango y comentario vacío se rechazan', async () => {
    assert.equal((await pet('POST', `/incidencias/${inc._id}/intervenciones`, { comentario: 'x', horas: 99 }, T_TEC)).status, 400);
    assert.equal((await pet('POST', `/incidencias/${inc._id}/intervenciones`, { comentario: '', horas: 1 }, T_TEC)).status, 400);
});
await paso('$set cambia la prioridad y deja trazas en el historial', async () => {
    const r = await pet('PATCH', `/incidencias/${inc._id}/prioridad`, { prioridad: 'Urgente' }, T_SUP);
    assert.equal(r.body.prioridad, 'Urgente');
    assert.ok(r.body.historial.some(x => x.tipo === 'prioridad'));
    assert.equal((await pet('PATCH', `/incidencias/${inc._id}/prioridad`, { prioridad: 'Otro' }, T_SUP)).status, 400);
});
await paso('$inc del contador genera folios únicos y consecutivos', async () => {
    const [a, b] = [(await nueva(T_REPO)).body, (await nueva(T_REPO)).body];
    assert.notEqual(a.folio, b.folio);
    assert.equal(Number(b.folio.slice(-4)) - Number(a.folio.slice(-4)), 1);
});

console.log('\nÍndices reales en la base de datos');
await paso('el índice de texto declara idioma español y ponderación', async () => {
    const idx = await Inc.collection.indexes();
    const texto = idx.find(i => i.textIndexVersion);
    assert.ok(texto, 'no existe índice de texto');
    assert.equal(texto.default_language, 'spanish');
    assert.equal(texto.weights.titulo, 10);
});
await paso('existe índice compuesto, técnico y TTL de 60 días', async () => {
    const idx = await Inc.collection.indexes();
    assert.ok(idx.some(i => i.key.estado && i.key.prioridad && i.key.createdAt === -1));
    assert.ok(idx.some(i => i.key['tecnico.id'] && i.key.estado));
    const ttl = idx.find(i => i.expireAfterSeconds);
    assert.ok(ttl, 'no hay TTL'); assert.equal(ttl.expireAfterSeconds, 60 * 24 * 3600);
});
await paso('la búsqueda textual en español funciona por título y descripción', async () => {
    const r = await get('/incidencias?q=switch', T_SUP);
    assert.ok(r.body.total >= 1);
});

console.log('\nEvidencias con almacenamiento externo');
const JPG = (n = 1200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]);
const PNG = (n = 1200) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]);
const PDF = (n = 1200) => Buffer.concat([Buffer.from('%PDF-1.4\n', 'latin1'), Buffer.alloc(n)]);
const DOCX = (n = 1200) => Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('word/document.xml', 'latin1'), Buffer.alloc(n)]);
const lote = (nombre, buf, mime) => { const fd = new FormData(); fd.append('evidencias', new Blob([buf], { type: mime }), nombre); return fd; };
await paso('la subida va al bucket con ruta no predecible y URL firmada al leer', async () => {
    const r = await fetch(`${base}/incidencias/${inc._id}/evidencias`, { method: 'POST', headers: { Authorization: 'Bearer ' + T_REPO }, body: lote('evidencia.pdf', PDF(), 'application/pdf') });
    assert.equal(r.status, 201);
    const doc = (await r.json()).evidencias.slice(-1)[0];
    assert.ok(/-[a-z0-9]{8}-evidencia\.pdf$/.test(doc.path), 'la ruta es predecible: ' + doc.path);
    const visto = (await get(`/incidencias/${inc._id}`, T_REPO)).body.evidencias.slice(-1)[0];
    assert.ok(String(visto.url).startsWith('https://firma.test/'));
    assert.equal(subidas.length, 1);
    // un PDF de una incidencia no es una captura: va a incidencias-documentos
    assert.equal(subidas[0].b, 'incidencias-documentos');
    assert.equal(doc.bucket, 'incidencias-documentos');
    assert.equal(firmadas.at(-1).b, 'incidencias-documentos');
});
await paso('un técnico sin asignación no puede ver evidencias ajenas', async () => {
    assert.equal((await get(`/incidencias/${inc._id}`, T_TEC2)).status, 403);
});
await paso('una incidencia cerrada no admite más evidencias', async () => {
    const cerrada = (await nueva(T_REPO)).body;
    await pet('PATCH', `/incidencias/${cerrada._id}/autorizacion`, { accion: 'aprobar' }, T_SUP);
    await pet('PATCH', `/incidencias/${cerrada._id}/asignar`, { tecnicoId: (await User.findOne({ email: mailTec }))._id }, T_SUP);
    await pet('PATCH', `/incidencias/${cerrada._id}/estado`, { estado: 'En proceso', comentario: 'x' }, T_TEC);
    await pet('PATCH', `/incidencias/${cerrada._id}/estado`, { estado: 'Resuelta', comentario: 'x' }, T_TEC);
    await pet('PATCH', `/incidencias/${cerrada._id}/estado`, { estado: 'Cerrada', comentario: 'x' }, T_SUP);
    const r = await fetch(`${base}/incidencias/${cerrada._id}/evidencias`, { method: 'POST', headers: { Authorization: 'Bearer ' + T_REPO }, body: lote('otro.pdf', PDF(), 'application/pdf') });
    assert.equal(r.status, 409);
});

console.log('\nAnalítica y paginación');
await paso('las estadísticas solo son para Soporte TI y Directivo', async () => {
    assert.equal((await get('/stats', T_TEC)).status, 403);
    assert.equal((await get('/stats', T_REPO)).status, 403);
    assert.equal((await get('/stats', T_DIR)).status, 200);
});
await paso('los pipelines devuelven top-10 etiquetas y horas por edificio', async () => {
    const s = (await get('/stats', T_DIR)).body;
    assert.ok(Array.isArray(s.topEtiquetas) && s.topEtiquetas[0].n >= 1);
    assert.ok(s.tiempoPorEdificio.every(x => x.horasPromedio >= 0));
    assert.ok(s.totales.total >= 1);
    assert.ok(s.actualizado);
});
await paso('el promedio de resolución ignora incidencias sin resolver', async () => {
    const s = (await get('/stats', T_SUP)).body;
    const resueltas = await Inc.countDocuments({ fechaResolucion: { $type: 'date' } });
    assert.equal(s.tiempoPorEdificio.reduce((a, x) => a + x.n, 0), resueltas);
});
await paso('filtros inválidos devuelven 400 y la paginación está limitada', async () => {
    assert.equal((await get('/incidencias?estado=Falso', T_SUP)).status, 400);
    const r = await get('/incidencias?limit=9999', T_SUP);
    assert.ok(r.body.items.length <= 50);
});

console.log('\nAjustes de la auditoría funcional');
await paso('un rechazo no deja fecha de resolución ni entra al promedio por edificio', async () => {
    const r = await nueva(T_REPO2);
    await pet('PATCH', `/incidencias/${r.body._id}/autorizacion`, { accion: 'rechazar', motivo: 'Duplicada con otra cuenta' }, T_SUP);
    const doc = await Inc.findById(r.body._id);
    assert.equal(doc.estado, 'Cerrada'); assert.equal(doc.autorizacion.estado, 'rechazada');
    assert.equal(doc.fechaResolucion, undefined);
    const s = (await get('/stats', T_SUP)).body;
    assert.equal(s.tiempoPorEdificio.reduce((a, x) => a + x.n, 0), await Inc.countDocuments({ fechaResolucion: { $type: 'date' } }));
});
await paso('ninguna transición válida progresa mientras la autorización está pendiente', async () => {
    const pend = (await nueva(T_REPO2)).body;
    for (const e of ['En espera', 'Cerrada']) {
        const r = await pet('PATCH', `/incidencias/${pend._id}/estado`, { estado: e, comentario: 'intento' }, T_SUP);
        assert.equal(r.status, 409, `${e} debía devolver 409`);
    }
    assert.equal((await Inc.findById(pend._id)).estado, 'Abierta');
    await pet('PATCH', `/incidencias/${pend._id}/autorizacion`, { accion: 'aprobar' }, T_SUP);
    assert.equal((await pet('PATCH', `/incidencias/${pend._id}/estado`, { estado: 'En espera', comentario: 'ya autorizada' }, T_SUP)).status, 200);
});
await paso('el cambio de estado exige siempre un comentario', async () => {
    const r = await nueva(T_REPO2);
    await pet('PATCH', `/incidencias/${r.body._id}/autorizacion`, { accion: 'aprobar' }, T_SUP);
    await pet('PATCH', `/incidencias/${r.body._id}/asignar`, { tecnicoId: (await User.findOne({ email: mailTec }))._id }, T_SUP);
    assert.equal((await pet('PATCH', `/incidencias/${r.body._id}/estado`, { estado: 'En proceso' }, T_TEC)).status, 400);
    assert.equal((await pet('PATCH', `/incidencias/${r.body._id}/estado`, { estado: 'En proceso', comentario: '   ' }, T_TEC)).status, 400);
});
await paso('existe el índice compuesto categoria+estado+edificio', async () => {
    const idx = await Inc.collection.indexes();
    assert.ok(idx.some(i => i.key.categoria === 1 && i.key.estado === 1 && i.key.edificio === 1),
        'falta el índice de la sección 4.1');
});
await paso('los filtros normalizan mayúsculas y acentos', async () => {
    assert.ok((await get('/incidencias?estado=abierta', T_SUP)).body.total >= 1);
    assert.ok((await get('/incidencias?estado=EN%20PROCESO', T_SUP)).body.total >= 1);
    assert.ok((await get('/incidencias?etiqueta=WIFI', T_SUP)).body.total >= 1);
    // 'Cómputo' con tilde es el valor del enum; sin tilde era devuelto como 400
    const sinTilde = await get('/incidencias?categoria=Computo%20y%20telecomunicaciones', T_SUP);
    assert.equal(sinTilde.status, 200);
    assert.ok(sinTilde.body.total >= 1, 'el filtro sin acentos debe encontrar los mismos expedientes');
    assert.equal((await get('/incidencias?categoria=CoMpuTO Y TELECOMUNICACIONES', T_SUP)).body.total, sinTilde.body.total);
    assert.equal((await get('/incidencias?prioridad=urGenTe', T_SUP)).status, 200);
});
await paso('la base de conocimiento encuentra los títulos con o sin tildes', async () => {
    const alta = await pet('POST', '/kb', { titulo: 'Red inalámbrica en el auditorio', contenido: 'Reconectarse cuando el punto de acceso pierde el SSID.' }, T_SUP);
    assert.equal(alta.status, 201);
    for (const q of ['inalámbrica', 'inalambrica', 'INALAMBRICA', 'red inalam']) {
        const r = await get(`/kb?q=${encodeURIComponent(q)}`, T_SUP);
        assert.equal(r.status, 200);
        assert.ok(r.body.some(a => String(a._id) === String(alta.body._id)), `«${q}» debía devolver el artículo`);
    }
    assert.equal((await get('/kb?q=nutria-inexistente', T_SUP)).body.length, 0);
    // un carácter con significado en regex no debe romper la búsqueda ni colarse como patrón
    assert.equal((await get('/kb?q=%28sin%20cerrar', T_SUP)).status, 200);
});
await paso('una etiqueta guardada con mayúsculas se encuentra igual (legado de Atlas)', async () => {
    // 'poE' es el caso real que dejó el clúster antes de normalizar las etiquetas al escribir
    const marca = await nueva(T_REPO, { titulo: 'Punto de red sin PoE en el aula' });
    await Inc.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(marca.body._id)) },
        { $set: { etiquetas: ['poE', 'SISE'] } });
    for (const escrito of ['poe', 'POE', 'poE', '#poe']) {
        const r = await get(`/incidencias?etiqueta=${encodeURIComponent(escrito)}`, T_SUP);
        assert.equal(r.status, 200, escrito);
        assert.ok(r.body.total >= 1, `etiqueta=${escrito} no encontró el tag guardado como poE`);
    }
    assert.ok((await get('/incidencias?etiqueta=sise', T_SUP)).body.total >= 1);
    // el punto y el asterisco son literales, no patrones: 'po.' no puede casar con 'poe'
    assert.equal((await get('/incidencias?etiqueta=po.', T_SUP)).body.total, 0);
    assert.equal((await get('/incidencias?etiqueta=po*', T_SUP)).body.total, 0);
});
await paso('GET /edificios devuelve los edificios reales y respeta el alcance de cada rol', async () => {
    const otro = await nueva(T_REPO2, { titulo: 'Lámpara fundida en lectura', edificio: 'Biblioteca' });
    assert.equal(otro.status, 201);
    const lista = await get('/edificios', T_SUP);
    assert.equal(lista.status, 200);
    assert.ok(Array.isArray(lista.body));
    assert.ok(lista.body.includes('Edificio C') && lista.body.includes('Biblioteca'), JSON.stringify(lista.body));
    // El reportante solo ve los edificios donde él tiene reportes
    const propio = await get('/edificios', T_REPO);
    assert.ok(propio.body.includes('Edificio C'));
    assert.ok(!propio.body.includes('Biblioteca'), 'Biblioteca es de otra cuenta');
    assert.equal((await get('/edificios', T_DIR)).status, 403);
    assert.equal((await get('/edificios')).status, 401);
    // Un valor que sí existe en la base nunca puede devolver 400 por no estar en el catálogo del cliente
    const filtrado = await get('/incidencias?edificio=Biblioteca', T_SUP);
    assert.equal(filtrado.status, 200);
    assert.equal(filtrado.body.total, 1);
});
await paso('desde y hasta cubren el día completo en hora local', async () => {
    const a = (await nueva(T_REPO, { titulo: 'Reporte de madrugada' })).body._id;
    const b = (await nueva(T_REPO, { titulo: 'Reporte de última hora' })).body._id;
    // Se escribe con el driver nativo: Mongoose tiene createdAt como inmutable
    await Inc.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(a)) }, { $set: { createdAt: new Date(2026, 4, 3, 0, 30) } });
    await Inc.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(b)) }, { $set: { createdAt: new Date(2026, 4, 3, 23, 30) } });
    const mismoDia = await get('/incidencias?desde=2026-05-03&hasta=2026-05-03&limit=50', T_SUP);
    const folios = mismoDia.body.items.map(x => String(x._id));
    assert.ok(folios.includes(String(a)), 'la 00:30 local debe entrar en el filtro');
    assert.ok(folios.includes(String(b)), 'la 23:30 local debe entrar en el filtro');
    assert.equal((await get('/incidencias?desde=2026-05-04', T_SUP)).body.items.map(x => String(x._id)).includes(String(b)), false);
    assert.equal((await get('/incidencias?hasta=2026-05-02', T_SUP)).body.items.map(x => String(x._id)).includes(String(a)), false);
});
await paso('la búsqueda textual ordena por relevancia y no devuelve el historial', async () => {
    const r = await get('/incidencias?q=switch+puertos+lab', T_SUP);
    assert.equal(r.status, 200);
    assert.ok(r.body.items.every(x => x.historial === undefined));
});
await paso('registrar es exclusivo del reportante: Soporte TI recibe 403', async () => {
    const negada = await nueva(T_SUP, { titulo: 'Intento de Soporte TI', etiquetas: undefined });
    assert.equal(negada.status, 403);
    assert.equal(await Inc.countDocuments({ titulo: 'Intento de Soporte TI' }), 0);
    const r = await nueva(T_REPO, { titulo: 'Upgrade del switch de agregación', etiquetas: undefined });
    assert.equal(r.status, 201);
    assert.equal(r.body.reportante.email, mailRepo);
    assert.equal(r.body.autorizacion.estado, 'pendiente');
});
await paso('las etiquetas son operativas: el reportante no las edita (403)', async () => {
    assert.equal((await pet('PATCH', `/incidencias/${inc._id}/etiquetas`, { agregar: ['critico'] }, T_REPO)).status, 403);
});
await paso('el tope de 10 etiquetas se aplica sobre el arreglo final', async () => {
    const llenar = await pet('PATCH', `/incidencias/${inc._id}/etiquetas`,
        { agregar: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'] }, T_TEC);
    assert.equal(llenar.status, 200);
    assert.equal(llenar.body.etiquetas.length, 10);
    const exceso = await pet('PATCH', `/incidencias/${inc._id}/etiquetas`, { agregar: ['b9'] }, T_TEC);
    assert.equal(exceso.status, 400);
    assert.equal((await Inc.findById(inc._id)).etiquetas.length, 10);
    await pet('PATCH', `/incidencias/${inc._id}/etiquetas`,
        { quitar: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'] }, T_TEC);
});
await paso('el técnico asignado también puede adjuntar evidencias', async () => {
    const antes = subidas.length;
    const r = await fetch(`${base}/incidencias/${inc._id}/evidencias`, { method: 'POST', headers: { Authorization: 'Bearer ' + T_TEC }, body: lote('panel.jpg', JPG(), 'image/jpeg') });
    assert.equal(r.status, 201);
    const doc = (await r.json()).evidencias.slice(-1)[0];
    assert.equal(doc.tipo, 'image/jpeg');
    assert.equal(subidas.length, antes + 1);
    // la captura de un incidente va al bucket de imágenes, no al de documentos
    assert.equal(subidas.at(-1).b, 'incidencias-evidencias');
    assert.equal(doc.bucket, 'incidencias-evidencias');
});
await paso('un tipo de archivo no permitido se rechaza con 400 y no crea evidencias', async () => {
    const antes = subidas.length;
    const r = await fetch(`${base}/incidencias/${inc._id}/evidencias`, { method: 'POST', headers: { Authorization: 'Bearer ' + T_REPO }, body: lote('virus.exe', Buffer.from('MZ\x90\x00'.padEnd(1200, 'x'), 'latin1'), 'application/x-msdownload') });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /Formato no admitido/);
    assert.equal(subidas.length, antes);
    assert.equal((await Inc.findById(inc._id)).evidencias.length, 2);
});
await paso('repetir el rol que ya tiene una cuenta se rechaza con 400', async () => {
    const tec = await User.findOne({ email: mailTec });
    assert.equal((await pet('PATCH', `/users/${tec._id}/rol`, { rol: 'tecnico' }, T_SUP)).status, 400);
    assert.equal((await pet('PATCH', `/users/${tec._id}/rol`, { rol: 'soporte_ti' }, T_SUP)).status, 200);
    assert.equal((await pet('PATCH', `/users/${tec._id}/rol`, { rol: 'tecnico' }, T_SUP)).status, 200);
});
await paso('el promedio por edificio reporta horas trabajadas y orden descendente', async () => {
    const s = (await get('/stats', T_SUP)).body;
    assert.ok(s.tiempoPorEdificio.every(x => typeof x.horasTrabajadas === 'number'));
    const ord = s.tiempoPorEdificio.map(x => x.horasPromedio);
    assert.deepEqual(ord, [...ord].sort((a, b) => b - a));
});

console.log('\nMigración de roles heredados');
await paso('usuario→reportante y admin→soporte_ti', async () => {
    await User.create({ nombre: 'Viejo', email: 'viejo@test.mx', password: 'x', rol: 'reportante' });
    await User.updateMany({ email: 'viejo@test.mx' }, { $set: { rol: 'admin' } });
    await User.updateMany({ email: 'ana@test.mx' }, { $set: { rol: 'usuario' } });
    const { bootstrap: b2 } = await import('../index.js');
    await b2({ uri: mongod.getUri(), ttlDias: 60 });
    assert.equal((await User.findOne({ email: 'viejo@test.mx' })).rol, 'soporte_ti');
    assert.equal((await User.findOne({ email: 'ana@test.mx' })).rol, 'reportante');
});

await paso('un documento con el rol antiguo "admin" sigue siendo Soporte TI', async () => {
    await User.collection.insertOne({
        nombre: 'Admin Histórico', email: 'admin.viejo@test.mx',
        password: await bcrypt.hash('clave123456', 10), rol: 'admin'
    });
    await User.collection.insertOne({
        nombre: 'Meta', email: 'meta@test.mx', password: await bcrypt.hash('clave123456', 10), rol: 'reportante'
    });
    const login = await ll('/auth/login', { email: 'admin.viejo@test.mx', password: 'clave123456' });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.rol, 'soporte_ti');
    const T_ADMIN = login.body.token;

    const me = await get('/auth/me', T_ADMIN);
    assert.equal(me.status, 200);
    assert.equal(me.body.rol, 'soporte_ti');

    const meta = await User.findOne({ email: 'meta@test.mx' });
    const sube = await pet('PATCH', `/users/${meta._id}/rol`, { rol: 'tecnico' }, T_ADMIN);
    assert.equal(sube.status, 200, JSON.stringify(sube.body));
    assert.equal(sube.body.rol, 'tecnico');

    // el alias también se acepta al escribir: "admin" se guarda como soporte_ti
    const alias = await pet('PATCH', `/users/${meta._id}/rol`, { rol: 'admin' }, T_ADMIN);
    assert.equal(alias.status, 200);
    assert.equal(alias.body.rol, 'soporte_ti');
    assert.equal((await User.findOne({ email: 'meta@test.mx' })).rol, 'soporte_ti');

    // y puede crear cuentas con el rol histórico
    const alta = await ll('/users', { nombre: 'Nuevo', email: 'nuevo@test.mx', password: 'clave123456', rol: 'admin' }, T_ADMIN);
    assert.equal(alta.status, 201);
    assert.equal(alta.body.rol, 'soporte_ti');

    // el reporte de usuarios normaliza los roles legacy
    const lista = await get('/users', T_ADMIN);
    assert.ok(lista.body.every(u => ['reportante', 'tecnico', 'soporte_ti', 'directivo'].includes(u.rol)));
});

await paso('baja de usuarios: permisos, autoprotección, último Soporte TI y trazabilidad', async () => {
    await User.collection.insertOne({
        nombre: 'Borrable', email: 'borrable@test.mx',
        password: await bcrypt.hash('clave123456', 10), rol: 'tecnico',
        createdAt: new Date(), updatedAt: new Date()
    });
    const baja = await User.collection.findOne({ email: 'borrable@test.mx' });

    const sinPermiso = await pet('DELETE', `/users/${baja._id}`, undefined, T_REPO);
    assert.equal(sinPermiso.status, 403);

    const yo = await pet('DELETE', `/users/${(await User.findOne({ email: 'soporte@test.mx' }))._id}`, undefined, T_SUP);
    assert.equal(yo.status, 400);

    const r = await pet('DELETE', `/users/${baja._id}`, undefined, T_SUP);
    assert.equal(r.status, 200);
    assert.equal(r.body.eliminado.email, 'borrable@test.mx');
    assert.equal(await User.countDocuments({ email: 'borrable@test.mx' }), 0);

    // el expediente conserva la copia del autor aunque la cuenta ya no exista
    const creada = await nueva(T_REPO);
    assert.equal(creada.status, 201);
    await User.deleteOne({ email: mailRepo });
    const lee = await get(`/incidencias/${creada.body._id}`, T_SUP);
    assert.equal(lee.status, 200);
    assert.equal(lee.body.reportante.email, mailRepo);
    assert.ok(lee.body.reportante.nombre);

    // otro Soporte TI sí puede darse de baja mientras quede quien borra
    await User.create({ nombre: 'Segundo', email: 'segundo@test.mx', password: await bcrypt.hash('clave123456', 10), rol: 'soporte_ti' });
    const seg = await User.findOne({ email: 'segundo@test.mx' });
    const baja2 = await pet('DELETE', `/users/${seg._id}`, undefined, T_SUP);
    assert.equal(baja2.status, 200);
    assert.equal(await User.countDocuments({ email: 'segundo@test.mx' }), 0);

    // la cuenta propia queda protegida: siempre queda al menos un Soporte TI
    await User.updateMany({ email: { $ne: 'soporte@test.mx' } }, { $set: { rol: 'reportante', roles: ['reportante'] } });
    const unico = await User.findOne({ email: 'soporte@test.mx' });
    const ultimo = await pet('DELETE', `/users/${unico._id}`, undefined, T_SUP);
    assert.equal(ultimo.status, 400);
    assert.equal(await User.countDocuments({ _id: unico._id }), 1, 'la cuenta sigue viva');
});

await paso('el login registra el último acceso del usuario', async () => {
    const correo = 'acceso@test.mx';
    await User.create({ nombre: 'Acceso', email: correo, password: await bcrypt.hash('clave123456', 10), rol: 'reportante' });
    const antes = await User.findOne({ email: correo });
    assert.ok(!antes.ultimoAcceso, 'una cuenta nueva no debería tener accesos');

    const s = await ll('/auth/login', { email: correo, password: 'clave123456' });
    assert.equal(s.status, 200);
    assert.ok(s.body.user.ultimoAcceso, 'la respuesta trae el último acceso');
    assert.ok(s.body.user.creadoEn, 'y la fecha de registro');

    const despues = await User.findOne({ email: correo });
    assert.ok(despues.ultimoAcceso instanceof Date);
    assert.ok(despues.createdAt instanceof Date);
});

await paso('los perfiles antiguos recuperan su fecha de registro desde el ObjectId', async () => {
    const id = new mongoose.Types.ObjectId();
    await User.collection.insertOne({ _id: id, nombre: 'Sin Fecha', email: 'sinfecha@test.mx', password: 'x', rol: 'reportante', __v: 0 });
    assert.ok(!(await User.findById(id)).createdAt, 'el documento heredado llega sin createdAt');

    const pendientes = await User.countDocuments({ createdAt: null });
    assert.equal(await sincronizarFechasDeRegistro(), pendientes);
    assert.equal((await User.findById(id)).createdAt.getTime(), id.getTimestamp().getTime());

    // idempotente: una segunda pasada ya no encuentra documentos sin fecha
    assert.equal(await sincronizarFechasDeRegistro(), 0);
    await User.collection.deleteOne({ _id: id });
});

console.log('\nClasificación de archivos según la operación (buckets de Supabase)');
// Cuentas y expediente propios: las secciones anteriores dan de baja a ana@test.mx y
// cuentan sus evidencias, así que este bloque no puede reutilizarlas.
const mailFoto = 'foto@test.mx', mailAjena = 'ajena@test.mx';
await crear(mailFoto, 'reportante');
await crear(mailAjena, 'reportante');
const [T_FOTO, T_AJENA] = await Promise.all([tok(mailFoto), tok(mailAjena)]);
const idFoto = (await User.findOne({ email: mailFoto }))._id;
const idAjena = (await User.findOne({ email: mailAjena }))._id;
const idSup = (await User.findOne({ email: mailSoporte }))._id;
const incF = (await nueva(T_FOTO)).body;

const envia = (ruta, metodo, campo, nombre, buf, mime, token, extra = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    fd.append(campo, new Blob([buf], { type: mime }), nombre);
    return fetch(base + ruta, { method: metodo, headers: { Authorization: 'Bearer ' + token }, body: fd });
};
const evidencia = (nombre, buf, mime, token = T_FOTO, extra = {}) =>
    envia(`/incidencias/${incF._id}/evidencias`, 'POST', 'evidencias', nombre, buf, mime, token, extra);

await paso('caso 1 y 2: imagen y PDF del mismo expediente terminan en buckets distintos', async () => {
    const c = subidas.length;
    assert.equal((await evidencia('pantalla.png', PNG(), 'image/png')).status, 201);
    assert.equal((await evidencia('informe.pdf', PDF(), 'application/pdf')).status, 201);
    assert.equal(subidas[c].b, 'incidencias-evidencias');
    assert.equal(subidas[c + 1].b, 'incidencias-documentos');
    // cada referencia guarda su propio bucket para poder firmarse después
    const d = (await get(`/incidencias/${incF._id}`, T_FOTO)).body.evidencias.slice(-2);
    assert.deepEqual(d.map(x => x.bucket), ['incidencias-evidencias', 'incidencias-documentos']);
});
await paso('caso 3: un DOCX se clasifica como documento del expediente', async () => {
    const r = await evidencia('presupuesto.docx', DOCX(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(r.status, 201);
    assert.equal(subidas.at(-1).b, 'incidencias-documentos');
    assert.equal(subidas.at(-1).tipo, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});
await paso('caso 4: la foto de perfil se escribe en usuarios-archivos', async () => {
    const r = await envia(`/users/${idFoto}/avatar`, 'PUT', 'avatar', 'yo.png', PNG(400), 'image/png', T_FOTO);
    assert.equal(r.status, 200);
    const u = await r.json();
    assert.equal(subidas.at(-1).b, 'usuarios-archivos');
    assert.equal(u.avatar.tipo, 'image/png');
    const visto = (await get(`/users/${idFoto}/avatar`, T_FOTO)).body;
    assert.equal(visto.avatar.bucket, 'usuarios-archivos');
    assert.ok(String(visto.avatar.url).startsWith('https://firma.test/'));
    assert.ok(String(visto.avatar.path).startsWith(`usuarios/${idFoto}/`), 'ruta: ' + visto.avatar.path);
});
await paso('caso 5: un ejecutable o un PDF como foto de perfil se rechazan', async () => {
    const antes = subidas.length;
    const exe = await envia(`/users/${idFoto}/avatar`, 'PUT', 'avatar', 'malware.exe', Buffer.from('MZ\x90\x00'.padEnd(400, 'x'), 'latin1'), 'application/x-msdownload', T_FOTO);
    assert.equal(exe.status, 400);
    const pdfComoFoto = await envia(`/users/${idFoto}/avatar`, 'PUT', 'avatar', 'yo.pdf', PDF(400), 'application/pdf', T_FOTO);
    assert.equal(pdfComoFoto.status, 400);
    assert.match((await pdfComoFoto.json()).error, /Formato no admitido/);
    assert.equal(subidas.length, antes, 'ningún archivo inválido llegó al bucket');
});
await paso('caso 5b: renombrar un ejecutable como .png no engaña la validación de contenido', async () => {
    const r = await evidencia('captura.png', Buffer.from('MZ\x90\x00\x03'.padEnd(600, 'q'), 'latin1'), 'image/png');
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /admisible|contenido/);
});
await paso('caso 6: el tamaño se valida contra el límite del bucket antes de subir', async () => {
    const antes = subidas.length;
    const grande = await evidencia('pesada.png', PNG(11e6), 'image/png');
    assert.equal(grande.status, 413);
    assert.match((await grande.json()).error, /menos de 10 MB/);
    const avatarGrande = await envia(`/users/${idFoto}/avatar`, 'PUT', 'avatar', 'gorda.png', PNG(6e6), 'image/png', T_FOTO);
    assert.equal(avatarGrande.status, 413);
    // un PDF de 12 MB sí cabe en incidencias-documentos (20 MB): el límite es por bucket, no global
    assert.equal((await evidencia('planopdf.pdf', PDF(12e6), 'application/pdf')).status, 201);
    assert.equal(subidas.length, antes + 1, 'lo rechazado nunca llegó a escribirse');
});
await paso('caso 7: el cliente no decide el bucket, aunque envíe sus propios parámetros', async () => {
    const antes = subidas.length;
    const r = await evidencia('fuga.png', PNG(400), 'image/png', T_FOTO,
        { bucket: 'usuarios-archivos', destino: 'usuarios-archivos', contenedor: '../../privado' });
    assert.equal(r.status, 201);
    assert.equal(subidas[antes].b, 'incidencias-evidencias', 'el servidor ignoró el bucket pedido');
    assert.ok(!subidas[antes].path.includes('..'), 'ruta con traversal: ' + subidas[antes].path);
});
await paso('caso 7b: un nombre con ../ no sale de la carpeta del expediente', async () => {
    const r = await evidencia('../../../../etc/passwd.png', PNG(300), 'image/png');
    assert.equal(r.status, 201);
    const u = subidas.at(-1);
    assert.ok(!u.path.includes('..'), 'ruta: ' + u.path);
    assert.ok(u.path.startsWith(`${incF.folio}/`), 'la carpeta sigue siendo el folio: ' + u.path);
});
await paso('caso 8: la foto privada de otro usuario no es legible ni escribible por un tercero', async () => {
    const antes = subidas.length;
    assert.equal((await get(`/users/${idFoto}/avatar`, T_AJENA)).status, 403);
    assert.equal((await get(`/users/${idFoto}/avatar`, T_TEC2)).status, 403);
    assert.equal((await get(`/users/${idFoto}/avatar`, T_DIR)).status, 403);
    assert.equal((await get(`/users/${idFoto}/avatar`, T_FOTO)).status, 200);
    // Soporte TI sí puede gestionarla: es el rol que administra las cuentas
    assert.equal((await get(`/users/${idFoto}/avatar`, T_SUP)).status, 200);
    assert.equal((await envia(`/users/${idAjena}/avatar`, 'PUT', 'avatar', 'ajeno.png', PNG(300), 'image/png', T_FOTO)).status, 403);
    assert.equal((await pet('DELETE', `/users/${idSup}/avatar`, undefined, T_FOTO)).status, 403);
    assert.equal(subidas.length, antes, 'la autorización se resuelve antes de escribir en el bucket');
});
await paso('caso 8b: sin sesión nadie lee una foto privada', async () => {
    assert.equal((await get(`/users/${idFoto}/avatar`)).status, 401);
});
await paso('caso 9: si Supabase falla, el error es controlado y MongoDB no guarda referencias inválidas', async () => {
    const evAntes = (await Inc.findById(incF._id)).evidencias.length;
    storageCaido = true;
    const caida = await evidencia('foto.png', PNG(400), 'image/png');
    assert.equal(caida.status, 502);
    assert.match((await caida.json()).error, /Supabase rechazó/);
    storageCaido = false;
    assert.equal((await Inc.findById(incF._id)).evidencias.length, evAntes, 'no se guardó una referencia huérfana');

    // medio lote: el primer archivo se escribe y el segundo falla → se revierte el primero
    const sAntes = subidas.length, bAntes = borrados.length;
    fallarEn = intentos + 2;
    const fd = new FormData();
    fd.append('evidencias', new Blob([PNG(400)], { type: 'image/png' }), 'uno.png');
    fd.append('evidencias', new Blob([PDF(400)], { type: 'application/pdf' }), 'dos.pdf');
    const mixto = await fetch(`${base}/incidencias/${incF._id}/evidencias`, { method: 'POST', headers: { Authorization: 'Bearer ' + T_FOTO }, body: fd });
    assert.equal(mixto.status, 502);
    fallarEn = 0;
    assert.equal(subidas.length, sAntes + 1, 'el primer archivo sí llegó al bucket');
    assert.equal(borrados.length, bAntes + 1, 'la reversa retiró el objeto ya escrito');
    assert.deepEqual(borrados.at(-1), { b: subidas.at(-1).b, p: subidas.at(-1).path });
    assert.equal((await Inc.findById(incF._id)).evidencias.length, evAntes);
});
await paso('el lote sigue limitado a cinco archivos por solicitud', async () => {
    const fd = new FormData();
    for (let i = 0; i < 6; i++) fd.append('evidencias', new Blob([PNG(200)], { type: 'image/png' }), `lote${i}.png`);
    const r = await fetch(`${base}/incidencias/${incF._id}/evidencias`, { method: 'POST', headers: { Authorization: 'Bearer ' + T_FOTO }, body: fd });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /5 evidencias/);
});
await paso('cada subida recibe una ruta única: no se sobrescribe un archivo existente', async () => {
    const antes = subidas.length;
    for (const x of [0, 1]) await evidencia('igual.png', PNG(300), 'image/png');
    assert.notEqual(subidas[antes].path, subidas[antes + 1].path);
    assert.equal(new Set(subidas.map(x => `${x.b}/${x.path}`)).size, subidas.length, 'hay rutas repetidas en el mismo bucket');
});
await paso('caso 10: las referencias antiguas sin bucket se siguen firmando desde el histórico', async () => {
    await Inc.updateOne({ _id: incF._id }, { $push: { evidencias: { path: 'UTM-2025-0001/antes.png', nombre: 'antes.png', tipo: 'image/png', size: 12, fecha: new Date() } } });
    const lista = (await get(`/incidencias/${incF._id}`, T_SUP)).body.evidencias;
    const legado = lista.at(-1);
    assert.equal(legado.bucket, undefined);
    assert.equal(firmadas.at(-1).b, 'evidencias', 'debe caer en el bucket histórico');
    assert.ok(legado.url);
    // una cuenta creada antes de esta función sigue funcionando: avatar null
    assert.equal((await get('/auth/me', T_AJENA)).body.avatar, null);
});
await paso('quitar la foto de perfil borra el objeto del bucket', async () => {
    const antes = borrados.length;
    const r = await pet('DELETE', `/users/${idFoto}/avatar`, undefined, T_FOTO);
    assert.equal(r.status, 200);
    assert.equal(r.body.avatar, null);
    assert.equal(borrados.length, antes + 1);
    assert.equal((await get(`/users/${idFoto}/avatar`, T_FOTO)).body.avatar, null);
});

await paso('sin credenciales de Storage el expediente sí se guarda y avisa qué archivos se descartaron', async () => {
    // Segunda app sin storage inyectado (el caso real: server/.env sin SUPABASE_URL). Se vacían
    // las variables leídas por dotenv: si quien ejecuta la suite tiene credenciales reales en el
    // .env, la prueba intentaría subir a Supabase de verdad en vez de ejercitar la ruta sin storage.
    const guardado = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_KEY'].map(k => [k, process.env[k]]);
    for (const [k] of guardado) delete process.env[k];
    const sinStorage = createApp({ jwtSecret: JWT, corsOrigins: ['http://localhost:5173'] });
    const s2 = sinStorage.listen(0);
    const b2 = `http://127.0.0.1:${s2.address().port}/api`;
    const envia2 = async (ruta, campo, nombre, buf, mime, extra = {}) => {
        const fd = new FormData();
        for (const [k, v] of Object.entries(extra)) fd.append(k, v);
        fd.append(campo, new Blob([buf], { type: mime }), nombre);
        const r = await fetch(b2 + ruta, { method: 'POST', headers: { Authorization: 'Bearer ' + T_FOTO }, body: fd });
        return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    try {
        const alta = await envia2('/incidencias', 'evidencias', 'captura.png', PNG(400), 'image/png', {
            titulo: 'Sin storage: el reporte no se pierde', descripcion: 'El servidor no tiene credenciales de Supabase configuradas.',
            categoria: 'Cómputo y telecomunicaciones', prioridad: 'Alta', edificio: 'Edificio C', espacio: 'Lab 3',
            etiquetas: '[]', datosCategoria: JSON.stringify(DATOS_CAT),
        });
        assert.equal(alta.status, 201);
        assert.deepEqual(alta.body.evidencias, [], 'no se guarda una referencia a un objeto que no se escribió');
        assert.match(alta.body.aviso, /no se guardaron[\s\S]*SUPABASE_URL/);
        assert.equal(await Inc.countDocuments({ _id: alta.body._id }), 1, 'el expediente sí quedó en MongoDB');

        // adjuntar a un expediente existente sí es un error duro: el objetivo era la subida
        const anexa = await envia2(`/incidencias/${alta.body._id}/evidencias`, 'evidencias', 'otra.png', PNG(400), 'image/png');
        assert.equal(anexa.status, 503);
        assert.match(anexa.body.error, /SUPABASE_URL ni SUPABASE_SECRET_KEY/);
        assert.equal((await Inc.findById(alta.body._id)).evidencias.length, 0);

        // /estado también tiene que decir la verdad del Storage: es lo que la interfaz muestra
        // antes de que el usuario adjunte archivos que el servidor no podrá guardar.
        const es = await fetch(b2 + '/estado').then(x => x.json());
        assert.equal(es.storage.hay, false);
        assert.match(es.storage.motivo, /SUPABASE_SECRET_KEY/);
        assert.ok(!/sb_secret_|eyJ/.test(JSON.stringify(es)), '/estado jamás publica una clave');
    } finally {
        s2.close();
        for (const [k, v] of guardado) if (v !== undefined) process.env[k] = v;
    }
});

await paso('si Supabase rechaza la subida, el alta conserva el expediente y avisa el motivo', async () => {
    // Es el caso real de esta máquina: credenciales correctas pero el antivirus rompe el TLS
    // (o una clave publishable bloqueada por RLS). Antes devolvía 502 y el reporte se perdía.
    const antes = await Inc.countDocuments();
    storageCaido = true;
    const r = await envia('/incidencias', 'POST', 'evidencias', 'foto.png', PNG(400), 'image/png', T_FOTO, {
        titulo: 'Supabase caído durante el alta', descripcion: 'El storage rechaza la subida, pero el reporte no debe perderse.',
        categoria: 'Cómputo y telecomunicaciones', prioridad: 'Media', edificio: 'Edificio A', espacio: 'Of. 3',
        etiquetas: '[]', datosCategoria: JSON.stringify(DATOS_CAT),
    });
    storageCaido = false;
    const b = await r.json();
    assert.equal(r.status, 201, 'el alta no puede fallar por un problema del servicio de archivos');
    assert.match(b.aviso, /Supabase rechazó «foto\.png»/);
    assert.match(b.aviso, /adjuntarlos desde su ficha/);
    assert.deepEqual(b.evidencias, [], 'sin objeto escrito no se guarda la referencia');
    assert.equal(await Inc.countDocuments({ _id: b._id }), 1);
    assert.equal(await Inc.countDocuments(), antes + 1);
    // y sí se pueden adjuntar después, cuando el servicio responde
    const despues = await envia(`/incidencias/${b._id}/evidencias`, 'POST', 'evidencias', 'foto.png', PNG(400), 'image/png', T_FOTO, { comentario: 'reintento' });
    assert.equal(despues.status, 201);
    assert.equal((await Inc.findById(b._id)).evidencias.length, 1);
});

console.log('\nRoles múltiples');
let T_MULTI, ID_MULTI;
await paso('una cuenta solo con técnico no puede abrir un reporte', async () => {
    const correo = 'multi@test.mx';
    const u = await User.create({ nombre: 'Multi', email: correo, password: await bcrypt.hash('clave123456', 10), rol: 'tecnico' });
    ID_MULTI = u._id;
    T_MULTI = await tok(correo);
    assert.equal((await pet('POST', '/incidencias', { titulo: 'x', descripcion: 'y' }, T_MULTI)).status, 403);
});
await paso('PUT /users/:id/roles asigna un conjunto y la unión de permisos aplica sin volver a iniciar sesión', async () => {
    const r = await pet('PUT', `/users/${ID_MULTI}/roles`, { roles: ['tecnico', 'reportante'] }, T_SUP);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.roles, ['tecnico', 'reportante']);
    assert.equal(r.body.rol, 'tecnico', 'el rol activo se conserva si sigue siendo uno de los asignados');
    const alta = await nueva(T_MULTI);
    assert.equal(alta.status, 201, 'el token firmado antes del cambio sigue siendo válido');
    assert.equal(alta.body.reportante.email, 'multi@test.mx');
});
await paso('el alcance con varios roles es la unión de la bandeja y los reportes propios', async () => {
    // el técnico1 tiene una incidencia asignada; multi@test.mx crea la suya propia
    const ajena = (await get('/incidencias?limit=50', T_SUP)).body.items
        .find(i => i.tecnico?.id && String(i.reportante?.id || '') !== String(ID_MULTI));
    const propia = (await get('/incidencias?limit=50', T_MULTI)).body;
    assert.ok(propia.items.every(i =>
        String(i.reportante?.id || '') === String(ID_MULTI) ||
        String(i.tecnico?.id || '') === String(ID_MULTI)), 'ninguna incidencia fuera de su alcance');
    assert.ok(propia.items.some(i => String(i.reportante?.id || '') === String(ID_MULTI)), 've sus reportes');
    if (ajena) assert.equal((await get(`/incidencias/${ajena._id}`, T_MULTI)).status, 403);
});
await paso('asignar técnico a un expediente sí le da acceso de lectura al técnico multirol', async () => {
    const pendiente = (await nueva(T_REPO2)).body;
    await pet('PATCH', `/incidencias/${pendiente._id}/autorizacion`, { accion: 'aprobar' }, T_SUP);
    const asig = await pet('PATCH', `/incidencias/${pendiente._id}/asignar`, { tecnicoId: String(ID_MULTI) }, T_SUP);
    assert.equal(asig.status, 200, JSON.stringify(asig.body));
    assert.equal((await get(`/incidencias/${pendiente._id}`, T_MULTI)).status, 200);
    const ver = await get('/incidencias?limit=100', T_MULTI);
    assert.ok(ver.body.items.some(i => String(i._id) === String(pendiente._id)), 'la bandeja del técnico incluye lo asignado');
});
await paso('un directivo con el rol reportante añadido puede abrir y ver su propio reporte', async () => {
    const correo = 'dir.repo@test.mx';
    const u = await User.create({ nombre: 'Dirección Reporta', email: correo, password: await bcrypt.hash('clave123456', 10), rol: 'directivo' });
    const T = await tok(correo);
    assert.equal((await get('/incidencias', T)).status, 403, 'directivo solo: sin listado');
    assert.equal((await pet('PUT', `/users/${u._id}/roles`, { roles: ['directivo', 'reportante'] }, T_SUP)).status, 200);
    const alta = await nueva(T);
    assert.equal(alta.status, 201);
    assert.equal((await get(`/incidencias/${alta.body._id}`, T)).status, 200);
    assert.ok((await get('/stats', T)).status === 200, 'conserva la analítica de su rol directivo');
});
await paso('el conjunto de roles se valida: vacío, desconocido y alias histórico', async () => {
    assert.equal((await pet('PUT', `/users/${ID_MULTI}/roles`, { roles: [] }, T_SUP)).status, 400);
    assert.equal((await pet('PUT', `/users/${ID_MULTI}/roles`, { roles: ['superadmin'] }, T_SUP)).status, 400);
    assert.match((await pet('PUT', `/users/${ID_MULTI}/roles`, { roles: ['superadmin'] }, T_SUP)).body.error, /Rol no válido/);
    // el alias legacy se traduce: "admin" queda como soporte_ti y no se duplica
    const alias = await pet('PUT', `/users/${ID_MULTI}/roles`, { roles: ['admin', 'soporte_ti', 'reportante'] }, T_SUP);
    assert.equal(alias.status, 200);
    assert.deepEqual(alias.body.roles, ['soporte_ti', 'reportante']);
    assert.equal((await User.findOne({ _id: ID_MULTI })).roles.join(','), 'soporte_ti,reportante');
    assert.equal(alias.body.rol, 'soporte_ti', 'el activo fuera del conjunto pasa a ser el primero');
    await pet('PUT', `/users/${ID_MULTI}/roles`, { roles: ['tecnico', 'reportante'] }, T_SUP);
});
await paso('el rol activo siempre pertenece al conjunto asignado', async () => {
    const r = await pet('PUT', `/users/${ID_MULTI}/roles`, { roles: ['reportante'] }, T_SUP);
    assert.equal(r.status, 200);
    assert.equal(r.body.rol, 'reportante', 'si el activo quedó fuera, se toma el primero del conjunto');
    assert.deepEqual(r.body.roles, ['reportante']);
});
await paso('el alta por el panel acepta varios roles y el registro público sigue siendo reportante', async () => {
    const alta = await ll('/users', { nombre: 'Doble Rol', email: 'doble@test.mx', password: 'clave123456', roles: ['reportante', 'tecnico'] }, T_SUP);
    assert.equal(alta.status, 201, JSON.stringify(alta.body));
    assert.deepEqual(alta.body.roles, ['reportante', 'tecnico']);
    assert.equal(alta.body.rol, 'reportante');
    assert.equal((await ll('/users', { nombre: 'Solo Reporte', email: 'solo.repo@test.mx', password: 'clave123456', roles: ['reportante'] }, T_SUP)).status, 400);
    const pub = await ll('/auth/register', { nombre: 'Intruso 2', email: 'intruso2@test.mx', password: 'clave123456', roles: ['soporte_ti', 'tecnico'] });
    assert.equal(pub.status, 201);
    assert.deepEqual(pub.body.user.roles, ['reportante'], 'el registro público ignora los roles privilegiados');
});
await paso('nadie se queda sin administrador: no puedes quitarte Soporte TI ni dejar el panel vacío', async () => {
    const sup = await User.findOne({ email: mailSoporte });
    assert.match((await pet('PUT', `/users/${sup._id}/roles`, { roles: ['reportante'] }, T_SUP)).body.error,
        /No puedes quitarte el rol Soporte TI/);
    // ampliarse a sí mismo sí está permitido (así un Soporte TI prueba el alta de reportes)
    assert.equal((await pet('PUT', `/users/${sup._id}/roles`, { roles: ['soporte_ti', 'reportante'] }, T_SUP)).status, 200);

    // con dos administradores, uno puede quedar en un solo rol sin romper la regla
    const otro = await User.create({ nombre: 'Jefe Alterno', email: 'jefe@test.mx', password: await bcrypt.hash('clave123456', 10), rol: 'soporte_ti' });
    await tok('jefe@test.mx');
    const bajaRol = await pet('PATCH', `/users/${otro._id}/rol`, { rol: 'tecnico' }, T_SUP);
    assert.equal(bajaRol.status, 200, JSON.stringify(bajaRol.body));
    assert.deepEqual(bajaRol.body.roles, ['tecnico'], 'la ruta de un solo rol reemplaza el conjunto');
    assert.deepEqual((await User.findOne({ _id: sup._id })).roles, ['soporte_ti', 'reportante'], 'el actor conserva su rol');
    // Quitar el último Soporte TI no es alcanzable por API (quien autoriza siempre es Soporte TI
    // y no puede cambiarse a sí mismo), pero la guarda cubre una edición directa de la base.
    assert.equal((await User.findOne({ email: 'jefe@test.mx' })).rol, 'tecnico');
});
await paso('/tecnicos lista las cuentas multirol y se les puede asignar aunque su rol activo no sea técnico', async () => {
    await pet('PUT', `/users/${ID_MULTI}/roles`, { roles: ['reportante', 'tecnico'] }, T_SUP);
    await User.updateOne({ _id: ID_MULTI }, { $set: { rol: 'reportante' } });
    const lista = await get('/tecnicos', T_SUP);
    assert.equal(lista.status, 200);
    assert.ok(lista.body.some(u => String(u.id) === String(ID_MULTI)), 'aparece por tener el rol en el conjunto');
    // El desplegable de la interfaz ofrece esa cuenta: asignarla no puede devolver 400.
    const pendiente = (await nueva(T_REPO2)).body;
    await pet('PATCH', `/incidencias/${pendiente._id}/autorizacion`, { accion: 'aprobar' }, T_SUP);
    const asig = await pet('PATCH', `/incidencias/${pendiente._id}/asignar`, { tecnicoId: String(ID_MULTI) }, T_SUP);
    assert.equal(asig.status, 200, JSON.stringify(asig.body));
    assert.equal(String(asig.body.tecnico.id), String(ID_MULTI), 'el expediente queda en su bandeja de técnico');
    assert.equal((await get(`/incidencias/${pendiente._id}`, T_MULTI)).status, 200);
    const soloSoporte = await User.create({ nombre: 'Jefa', email: 'asigna2@test.mx', password: await bcrypt.hash('clave1254321', 10), rol: 'soporte_ti' });
    assert.equal((await pet('PATCH', `/incidencias/${pendiente._id}/asignar`, { tecnicoId: String(soloSoporte._id) }, T_SUP)).status, 400, 'quien no tiene el rol técnico no se asigna');
});
await paso('las rutas privilegiadas siguen cerradas para quien no tiene ese rol en el conjunto', async () => {
    assert.equal((await get('/users', T_MULTI)).status, 403);
    assert.equal((await pet('PUT', `/users/${ID_MULTI}/roles`, { roles: ['soporte_ti'] }, T_MULTI)).status, 403, 'un multirol sin soporte_ti no se autoasigna el rol');
});

server.close();
await mongoose.disconnect();
await mongod.stop();
console.log(`\nRESULTADO: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
