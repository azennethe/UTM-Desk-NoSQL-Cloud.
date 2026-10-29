// Filtros contra MongoDB Atlas: diagnostica, crea los índices que faltan, siembra los datos de
// demostración si hacen falta, y comprueba cada filtro llamando a la API real.
//
//   node --use-system-ca filtros-atlas.mjs              // solo lectura: estado + filtros
//   node --use-system-ca filtros-atlas.mjs --arregla    // además crea los índices que faltan
//   node --use-system-ca filtros-atlas.mjs --sembrar    // y mete datos-demo/ si no hay incidencias 'demo'
//
// Nunca borra ni sobrescribe. `syncIndexes()` retira los índices que no vienen del schema, así que
// aquí los índices se crean uno por uno y se reporta lo que ya existía. La siembra respeta los
// folios, correos e ids que ya están en la base: solo inserta lo que falta.

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { createApp, Inc, User, filtrosQuery, regexTexto, AUT_ESTADOS } from './index.js';
import { cargaDemo } from './lee-demo.mjs';

const ARGV = process.argv.slice(2);
const ARREGLA = ARGV.includes('--arregla');
const SEMBRAR = ARGV.includes('--sembrar');
const JWT = 'clave-temporal-de-este-script-no-publicable';
const CLAVE_DEMO = 'Demo.2026';   // la de las cuentas de demostración, pública por diseño

let fallos = 0;
const informe = (etiqueta, ok, detalle) => {
    if (!ok) fallos++;
    console.log(`${ok ? '  ✓' : '  ✗'} ${etiqueta}${detalle ? ' — ' + detalle : ''}`);
};

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('Falta MONGODB_URI en server/.env: sin cluster no hay filtros que comprobar.');
    process.exit(1);
}

try {
    await mongoose.connect(uri, { tlsAllowInvalidCertificates: true, serverSelectionTimeoutMS: 15000 });
} catch (e) {
    console.log('\nAtlas NO responde:', String(e.message).split('\n')[0]);
    console.log('Si el motivo es el allowlist, añade esta IP en Atlas → Network Access y vuelve a ejecutar el script.');
    process.exit(2);
}

const base = mongoose.connection.db;
console.log(`\nAtlas conectado · base [${base.databaseName}] · host ${mongoose.connection.host}`);

// ---------------------------------------------------------------- 1. estado
const existentes = new Set((await base.listCollections().toArray()).map(c => c.name));
for (const c of ['incidencias', 'users', 'articulos', 'counters']) {
    console.log(`  ${c}: ${existentes.has(c) ? await base.collection(c).countDocuments() + ' documentos' : 'colección inexistente'}`);
}

const infoIndice = await Inc.collection.indexes();
console.log('\nÍndices de incidencias:', infoIndice.map(i => i.name).join(', ') || '(ninguno)');

// Los selectores filtran por campos exactos, pero la caja de búsqueda usa $text, que en Atlas
// responde 40151 si la colección no tiene índice textual: la búsqueda queda muerta aunque los
// menús sí funcionen. El índice textual aparece además con el campo vacío '' (default_language),
// así que aquí se reconoce por tener algún valor 'text' y no por el nombre.
const NECESARIOS = [
    { name: 'texto_incidencias', keys: { titulo: 'text', descripcion: 'text' },
      opts: { weights: { titulo: 10, descripcion: 3 }, default_language: 'spanish' }, textual: true },
    { name: 'categoria_estado_edificio', keys: { categoria: 1, estado: 1, edificio: 1 }, opts: {} },
    { name: 'estado_prioridad_fecha', keys: { estado: 1, prioridad: 1, createdAt: -1 }, opts: {} },
    { name: 'autorizacion_estado', keys: { 'autorizacion.estado': 1, estado: 1 }, opts: {} },
    { name: 'etiquetas_1', keys: { etiquetas: 1 }, opts: {} },
    { name: 'edificio_1', keys: { edificio: 1 }, opts: {} },
    { name: 'reportante_id', keys: { 'reportante.id': 1 }, opts: {} },
    { name: 'tecnico_id_estado', keys: { 'tecnico.id': 1, estado: 1 }, opts: {} },
];

const cubre = (i, n) => n.textual
    ? Object.values(i.key).some(v => String(v) === 'text')
    : JSON.stringify(Object.entries(i.key)) === JSON.stringify(Object.entries(n.keys));

const faltan = NECESARIOS.filter(n => !infoIndice.some(i => cubre(i, n)));
if (faltan.length) {
    console.log(`\nFaltan índices para los filtros: ${faltan.map(f => f.name).join(', ')}`);
    if (ARREGLA) {
        for (const f of faltan) {
            await Inc.collection.createIndex(f.keys, { name: f.name, ...f.opts });
            console.log(`  creado ${f.name}`);
        }
    } else {
        console.log('  vuelve a ejecutar con --arregla para crearlos (no se borra ningún índice existente)');
    }
} else {
    console.log('\nTodos los índices que usan los filtros ya existen.');
}

const optsColeccion = ((await base.listCollections({ name: 'incidencias' }).toArray())[0] || {}).options || {};
console.log(`Validador de la colección: ${optsColeccion.validator ? (optsColeccion.validationLevel || 'strict') : 'sin validador'}`);

// ---------------------------------------------------------------- 2. siembra
if (SEMBRAR) {
    const demo = await Inc.countDocuments({ origen: 'demo' });
    if (demo === 0) {
        // Se inserta por los modelos para que Mongoose convierta _id, fechas y ObjectIds anidados;
        // el validador $jsonSchema de la colección se sigue aplicando en el servidor.
        const Art = mongoose.model('Articulo');
        const correos = new Set((await User.find().select('email').lean()).map(u => String(u.email).toLowerCase()));
        const cuentas = cargaDemo('users').filter(u => !correos.has(String(u.email).toLowerCase()));
        if (cuentas.length) await User.insertMany(cuentas, { ordered: false });

        const idsArt = new Set((await Art.find().select('_id').lean()).map(a => String(a._id)));
        const arts = cargaDemo('articulos').filter(a => !idsArt.has(String(a._id)));
        if (arts.length) await Art.insertMany(arts, { ordered: false });

        for (const c of cargaDemo('counters')) {
            await base.collection('counters').updateOne({ _id: c._id }, { $setOnInsert: c }, { upsert: true });
        }

        const folios = new Set((await Inc.find().select('folio').lean()).map(i => i.folio));
        const lote = cargaDemo('incidencias').filter(i => !folios.has(i.folio));
        await Inc.insertMany(lote, { ordered: false });
        informe(`siembra desde datos-demo/ (${lote.length} incidencias, ${cuentas.length} cuentas, ${arts.length} artículos)`,
            (await Inc.countDocuments({ origen: 'demo' })) > 0,
            `origen=demo en Atlas: ${await Inc.countDocuments({ origen: 'demo' })}`);
    } else {
        console.log(`\nAtlas ya tiene ${demo} incidencias de demostración: no se siembra (no se sobrescribe ni se borra nada).`);
    }
}

// ---------------------------------------------------------------- 3. filtros por HTTP
const app = createApp({ jwtSecret: JWT, corsOrigins: ['http://localhost:5173'] });
const servidor = await new Promise(r => { const s = app.listen(4213, '127.0.0.1', () => r(s)); });
const RAIZ = 'http://127.0.0.1:4213/api';

// Ninguna clave se imprime ni se guarda: solo se compara la hash de la cuenta demo con 'Demo.2026'.
let token = null;
for (const u of await User.find({ $or: [{ rol: 'soporte_ti' }, { roles: 'soporte_ti' }] }).select('+password').lean()) {
    if (!(await bcrypt.compare(CLAVE_DEMO, u.password || ''))) continue;
    const r = await fetch(`${RAIZ}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, password: CLAVE_DEMO }),
    });
    if (r.ok) { token = (await r.json()).token; break; }
}
console.log(`\nSesión HTTP de Soporte TI: ${token ? 'abierta con la cuenta demo' : 'no disponible (ninguna cuenta de Soporte TI acepta la clave demo) — los filtros se comparan solo contra el driver'}`);

const ESTADOS = ['Abierta', 'En proceso', 'En espera', 'Resuelta', 'Cerrada'];
const PRIOS = ['Baja', 'Media', 'Alta', 'Urgente'];
const CATS = ['Cómputo y telecomunicaciones', 'Infraestructura física y mantenimiento', 'Sistemas y servicios académicos'];

const edificios = (await Inc.distinct('edificio')).filter(Boolean);
const etiquetas = (await Inc.distinct('etiquetas')).filter(Boolean);
console.log(`Edificios en Atlas (${edificios.length}): ${edificios.join(' · ') || '(ninguno)'}`);
console.log(`Etiquetas en Atlas (${etiquetas.length}): ${etiquetas.join(', ') || '(ninguna)'}`);

const comprueba = async (etiqueta, query, { esperaMin = 0 } = {}) => {
    const limpio = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '' && v !== undefined));
    let consulta;
    try { consulta = filtrosQuery({ query: limpio }); }
    catch (e) { return informe(`${etiqueta}`, false, `filtro rechazado: ${e.message}`); }
    const n = await Inc.countDocuments(consulta);
    if (n < esperaMin) return informe(`${etiqueta}`, false, `el clúster tiene ${n} documentos para ese filtro (se esperaban ≥${esperaMin})`);
    if (!token) return informe(`${etiqueta}`, true, `driver ${n} documentos · sin HTTP`);

    const r = await fetch(`${RAIZ}/incidencias?${new URLSearchParams(limpio)}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return informe(`${etiqueta}`, false, `HTTP ${r.status} ${j.error || ''}`);
    if (j.total !== n) return informe(`${etiqueta}`, false, `HTTP total=${j.total} ≠ driver ${n}`);
    if (!j.items.every(x => {
        for (const [k, v] of Object.entries(consulta)) {
            if (k === '$text' || k === 'createdAt') continue;
            if (k === 'etiquetas') return (x.etiquetas || []).some(t => v instanceof RegExp ? v.test(t) : t === v);
            if (k === 'autorizacion.estado') return x.autorizacion?.estado === v;
            if (x[k] !== v) return false;
        }
        return true;
    })) return informe(`${etiqueta}`, false, 'el servidor devolvió un documento que no cumple el filtro');
    return informe(`${etiqueta}`, true, `${n} documentos · HTTP 200`);
};

console.log('\nFiltros de los selectores');
const EXIGE = SEMBRAR ? 1 : 0;
for (const e of ESTADOS) await comprueba(`estado=${e}`, { estado: e }, { esperaMin: EXIGE });
for (const p of PRIOS) await comprueba(`prioridad=${p}`, { prioridad: p }, { esperaMin: EXIGE });
for (const c of CATS) await comprueba(`categoria=${c}`, { categoria: c }, { esperaMin: EXIGE });
for (const d of edificios) await comprueba(`edificio=${d}`, { edificio: d }, { esperaMin: 1 });
for (const a of AUT_ESTADOS) await comprueba(`autorizacion=${a}`, { autorizacion: a });
for (const t of etiquetas.slice(0, 8)) await comprueba(`etiqueta=${t}`, { etiqueta: t }, { esperaMin: 1 });

console.log('\nBúsqueda textual, base de conocimiento y combinaciones');
// Los términos salen del propio catálogo: exigir coincidencias con una palabra que nadie
// escribió convertiría un catálogo vacío en un falso fallo del filtro.
const Art = mongoose.model('Articulo');
const arts = await Art.find({}).limit(50).lean();
const palabras = txt => String(txt || '').split(/[^\p{L}\p{N}-]+/u).filter(w => w.replace(/-/g, '').length >= 5);
const sinAcento = w => w.normalize('NFD').replace(/\p{Diacritic}/gu, '');
const conTilde = arts.flatMap(a => palabras(a.titulo)).find(w => sinAcento(w) !== w) || '';
const sencilla = arts.flatMap(a => palabras(a.titulo)).find(w => sinAcento(w) === w) || '';
for (const palabra of ['proyector', 'impresora', 'red', 'cable', 'vlan']) await comprueba(`q=${palabra}`, { q: palabra });
if (token) {
    const H = { Authorization: `Bearer ${token}` };
    const terminos = [
        ...(sencilla ? [[sencilla, true], [sencilla.toUpperCase(), true]] : []),
        ...(conTilde ? [[conTilde, true], [sinAcento(conTilde), true]] : []),
        ['nutria-inexistente', false]
    ];
    for (const [t, esperadoSome] of terminos) {
        const r = await fetch(`${RAIZ}/kb?q=${encodeURIComponent(t)}`, { headers: H });
        const j = await r.json().catch(() => []);
        const rx = regexTexto(t);
        const driver = await Art.countDocuments(rx ? { $or: [{ titulo: rx }, { contenido: rx }] } : {});
        informe(`GET /kb?q=${t}`, r.ok && (esperadoSome ? j.length >= 1 : j.length === 0) && j.length === driver,
            `HTTP ${r.status}, ${j.length} artículos · driver ${driver}`);
    }
    const sinQ = await (await fetch(`${RAIZ}/kb`, { headers: H })).json();
    informe('GET /kb sin q devuelve el catálogo completo', Array.isArray(sinQ) && sinQ.length >= 1, `${sinQ.length} artículos`);
    const tecnicos = await fetch(`${RAIZ}/tecnicos`, { headers: H });
    const listaTec = await tecnicos.json();
    informe('GET /tecnicos (el desplegable de asignación) responde', tecnicos.ok && Array.isArray(listaTec) && listaTec.length >= 1, `${Array.isArray(listaTec) ? listaTec.length : 0} técnicos`);
}
await comprueba('desde=2020-01-01', { desde: '2020-01-01' }, { esperaMin: 1 });
await comprueba('hasta=2099-12-31', { hasta: '2099-12-31' }, { esperaMin: 1 });
await comprueba('rango 2026-09', { desde: '2026-09-01', hasta: '2026-09-30' });
await comprueba('estado=Abierta + prioridad=Urgente', { estado: 'Abierta', prioridad: 'Urgente' });
await comprueba('categoria + edificio + estado', { categoria: CATS[0], edificio: edificios[0] || '', estado: 'Resuelta' });
await comprueba('q + estado', { q: 'red', estado: 'Cerrada' });

console.log('\nNormalización (quien escribe no pone tildes)');
await comprueba('estado=«en proceso» en minúsculas', { estado: 'en proceso' });
await comprueba('prioridad=«URGENTE» en mayúsculas', { prioridad: 'URGENTE' });
await comprueba('categoria sin tilde', { categoria: 'Computo y telecomunicaciones' }, { esperaMin: EXIGE });
await comprueba('categoria con tilde y mayúsculas', { categoria: 'CÓMPUTO Y TELECOMUNICACIONES' }, { esperaMin: EXIGE });
await comprueba('edificio tal como lo lista la base', { edificio: edificios[0] || '' }, { esperaMin: 1 });

console.log('\nPaginación, edificios y analítica');
if (token) {
    const p1 = await (await fetch(`${RAIZ}/incidencias?limit=1&page=1`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const p2 = await (await fetch(`${RAIZ}/incidencias?limit=1&page=2`, { headers: { Authorization: `Bearer ${token}` } })).json();
    informe(`limit=1 sobre ${p1.total} documentos: páginas ${p1.pages}, page 1 y 2 distintas`,
        Boolean(p1.items?.[0] && p2.items?.[0] && p1.items[0]._id !== p2.items[0]._id),
        `${(p1.items?.[0] || {}).folio || '-'} vs ${(p2.items?.[0] || {}).folio || '-'}`);
    const conFiltro = await (await fetch(`${RAIZ}/incidencias?limit=1&page=1&estado=Resuelta`, { headers: { Authorization: `Bearer ${token}` } })).json();
    informe('filtro + paginación: el total es el del filtro, no el de la colección',
        conFiltro.total === await Inc.countDocuments(filtrosQuery({ query: { estado: 'Resuelta' } })), `total=${conFiltro.total}`);
    const rEd = await fetch(`${RAIZ}/edificios`, { headers: { Authorization: `Bearer ${token}` } });
    const cuerpos = await rEd.json();
    informe('GET /edificios responde los valores reales de la base',
        Array.isArray(cuerpos) && cuerpos.length === edificios.length, `${Array.isArray(cuerpos) ? cuerpos.length : 0} de ${edificios.length}`);
    const rStats = await fetch(`${RAIZ}/stats`, { headers: { Authorization: `Bearer ${token}` } });
    informe('GET /stats (los indicadores comparten los mismos filtros)', rStats.ok, `HTTP ${rStats.status}`);
    const rExcel = await fetch(`${RAIZ}/export/excel?estado=Abierta`, { headers: { Authorization: `Bearer ${token}` } });
    informe('GET /export/excel con filtro responde una hoja', rExcel.ok, `HTTP ${rExcel.status}, ${(await rExcel.text()).length} bytes`);
}

console.log('\nValores rechazados (no deben colarse en la consulta)');
for (const malo of [{ estado: 'Fantasma' }, { prioridad: 'Critical' }, { categoria: 'Otra' }, { autorizacion: 'autorizada' }]) {
    const k = Object.entries(malo)[0].join('=');
    if (!token) { informe(k, true, 'sin HTTP'); continue; }
    const r = await fetch(`${RAIZ}/incidencias?${new URLSearchParams(malo)}`, { headers: { Authorization: `Bearer ${token}` } });
    informe(`${k} → 400`, r.status === 400, `HTTP ${r.status}`);
}

await new Promise(r => servidor.close(r));
await mongoose.disconnect();
console.log(`\nRESULTADO: ${fallos ? fallos + ' comprobación(es) con problema' : 'todos los filtros responden igual por HTTP y por driver'}`);
process.exit(fallos ? 1 : 0);
