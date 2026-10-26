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

const mod = await import('../index.js');
const { createApp, bootstrap, sincronizarFechasDeRegistro, Inc, User } = mod;
await bootstrap({ uri: mongod.getUri(), ttlDias: 60 });

// almacenamiento falso: registra lo subido y firma URLs
const subidas = [];
const storage = {
    storage: {
        from: b => ({
            upload: async (path, buf, o) => { subidas.push({ b, path, size: buf.length, tipo: o.contentType }); return { error: null }; },
            createSignedUrl: async path => ({ data: { signedUrl: 'https://firma.test/' + encodeURIComponent(path) } })
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
await paso('CORS restringido al origen configurado y encabezados de seguridad', async () => {
    const r = await get('/incidencias', T_REPO, { Origin: 'http://localhost:5173' });
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5173');
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
    await User.updateOne({ email: mailSoporte }, { $set: { rol: 'reportante' } });
    assert.equal((await get('/incidencias/export', T_SUP)).status, 403);
    await User.updateOne({ email: mailSoporte }, { $set: { rol: 'soporte_ti' } });
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
await paso('la subida va al bucket con ruta no predecible y URL firmada al leer', async () => {
    const fd = new FormData();
    fd.append('evidencias', new Blob([Buffer.from('%PDF-1.4 prueba'.padEnd(1200, 'x'))], { type: 'application/pdf' }), 'evidencia.pdf');
    const r = await fetch(`${base}/incidencias/${inc._id}/evidencias`, { method: 'POST', headers: { Authorization: 'Bearer ' + T_REPO }, body: fd });
    assert.equal(r.status, 201);
    const doc = (await r.json()).evidencias.slice(-1)[0];
    assert.ok(/-[a-z0-9]{8}-evidencia\.pdf$/.test(doc.path), 'la ruta es predecible: ' + doc.path);
    const visto = (await get(`/incidencias/${inc._id}`, T_REPO)).body.evidencias.slice(-1)[0];
    assert.ok(String(visto.url).startsWith('https://firma.test/'));
    assert.equal(subidas.length, 1);
});
await paso('un técnico sin asignación no puede ver evidencias ajenas', async () => {
    assert.equal((await get(`/incidencias/${inc._id}`, T_TEC2)).status, 403);
});
await paso('una incidencia cerrada no admite más evidencias', async () => {
    const fd = new FormData();
    fd.append('evidencias', new Blob([Buffer.from('x'.repeat(1200))], { type: 'application/pdf' }), 'otro.pdf');
    const cerrada = (await nueva(T_REPO)).body;
    await pet('PATCH', `/incidencias/${cerrada._id}/autorizacion`, { accion: 'aprobar' }, T_SUP);
    await pet('PATCH', `/incidencias/${cerrada._id}/asignar`, { tecnicoId: (await User.findOne({ email: mailTec }))._id }, T_SUP);
    await pet('PATCH', `/incidencias/${cerrada._id}/estado`, { estado: 'En proceso', comentario: 'x' }, T_TEC);
    await pet('PATCH', `/incidencias/${cerrada._id}/estado`, { estado: 'Resuelta', comentario: 'x' }, T_TEC);
    await pet('PATCH', `/incidencias/${cerrada._id}/estado`, { estado: 'Cerrada', comentario: 'x' }, T_SUP);
    const r = await fetch(`${base}/incidencias/${cerrada._id}/evidencias`, { method: 'POST', headers: { Authorization: 'Bearer ' + T_REPO }, body: fd });
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
});
await paso('la búsqueda textual ordena por relevancia y no devuelve el historial', async () => {
    const r = await get('/incidencias?q=switch+puertos+lab', T_SUP);
    assert.equal(r.status, 200);
    assert.ok(r.body.items.every(x => x.historial === undefined));
});
await paso('Soporte TI puede registrar una incidencia y queda a su nombre', async () => {
    const r = await nueva(T_SUP, { titulo: 'Upgrade del switch de agregación', etiquetas: undefined });
    assert.equal(r.status, 201);
    assert.equal(r.body.reportante.email, mailSoporte);
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
    const fd = new FormData();
    fd.append('evidencias', new Blob([Buffer.from('\xff\xd8\xff'.padEnd(1200, 'x'))], { type: 'image/jpeg' }), 'panel.jpg');
    const r = await fetch(`${base}/incidencias/${inc._id}/evidencias`, { method: 'POST', headers: { Authorization: 'Bearer ' + T_TEC }, body: fd });
    assert.equal(r.status, 201);
    const doc = (await r.json()).evidencias.slice(-1)[0];
    assert.equal(doc.tipo, 'image/jpeg');
    assert.equal(subidas.length, antes + 1);
});
await paso('un tipo de archivo no permitido se rechaza con 400 y no crea evidencias', async () => {
    const antes = subidas.length;
    const fd = new FormData();
    fd.append('evidencias', new Blob([Buffer.from('MZ'.padEnd(1200, 'x'))], { type: 'application/x-msdownload' }), 'virus.exe');
    const r = await fetch(`${base}/incidencias/${inc._id}/evidencias`, { method: 'POST', headers: { Authorization: 'Bearer ' + T_REPO }, body: fd });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /JPG, PNG o PDF/);
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
    await User.updateMany({ email: { $ne: 'soporte@test.mx' } }, { $set: { rol: 'reportante' } });
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

server.close();
await mongoose.disconnect();
await mongod.stop();
console.log(`\nRESULTADO: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
