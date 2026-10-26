import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { buildWorkbook } from './excel.js';
import { createClient } from '@supabase/supabase-js';

const { Schema, model } = mongoose;

export const ROLES = ['reportante', 'tecnico', 'soporte_ti', 'directivo'];
// Alias de la nomenclatura anterior: una cuenta creada como "admin" sigue siendo Soporte TI
// aunque su documento todavía diga "admin", y "usuario" sigue siendo reportante.
export const ROL_ALIAS = { admin: 'soporte_ti', usuario: 'reportante' };
export const rolEfectivo = r => ROL_ALIAS[r] || r;
export const ESTADOS = ['Abierta', 'En proceso', 'En espera', 'Resuelta', 'Cerrada'];
export const PRIOS = ['Baja', 'Media', 'Alta', 'Urgente'];
export const CATS = ['Cómputo y telecomunicaciones', 'Infraestructura física y mantenimiento', 'Sistemas y servicios académicos'];
export const AUT_ESTADOS = ['pendiente', 'aprobada', 'rechazada'];

// Único punto donde se construye el cliente del bucket privado: la API y el seed lo comparten
export const clienteSupabase = () => (String(process.env.SUPABASE_URL || '').startsWith('http') && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null);

// Campos estructurados exigidos por categoría (requisito 2.1)
export const CAMPOS_CATEGORIA = {
    [CATS[0]]: { req: ['tipo_equipo', 'equipos_afectados'], opt: ['direccion_ip', 'vlan'] },
    [CATS[1]]: { req: ['tipo_infraestructura', 'area_afectada'], opt: ['riesgo_estructural', 'requiere_tercero'] },
    [CATS[2]]: { req: ['sistema_afectado', 'tipo_falla'], opt: ['usuarios_afectados', 'modulo'] }
};

// Máquina de estados: qué transiciones están permitidas y quién puede aplicarlas
export const TRANSICIONES = {
    'Abierta': ['En proceso', 'En espera', 'Cerrada'],
    'En proceso': ['En espera', 'Resuelta'],
    'En espera': ['En proceso', 'Resuelta', 'Cerrada'],
    'Resuelta': ['Cerrada', 'En proceso'],
    'Cerrada': []
};
const PUEDE_CERRAR = ['soporte_ti'];
const PUEDE_RESOLVER = ['tecnico', 'soporte_ti'];

const norm = v => String(v ?? '').trim().toLowerCase();
const estadoIgual = (a, b) => norm(a) === norm(b);

export const User = model('User', new Schema({
    nombre: { type: String, required: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    rol: { type: String, enum: ROLES, default: 'reportante' },
    ultimoAcceso: Date
}, { timestamps: true, collection: 'users' }));

const Counter = model('Counter', new Schema({ _id: String, n: Number }, { collection: 'counters' }));

const Art = model('Articulo', new Schema({
    titulo: { type: String, required: true, maxlength: 120 },
    contenido: { type: String, required: true, maxlength: 4000 },
    autor: String
}, { timestamps: true, collection: 'articulos' }));

const incSchema = new Schema({
    folio: { type: String, unique: true },
    titulo: { type: String, required: true, maxlength: 80 },
    descripcion: { type: String, required: true, maxlength: 4000 },
    categoria: { type: String, enum: CATS, required: true },
    prioridad: { type: String, enum: PRIOS, required: true },
    estado: { type: String, enum: ESTADOS, default: 'Abierta' },
    autorizacion: {
        estado: { type: String, enum: AUT_ESTADOS, default: 'pendiente' },
        por: { id: Schema.Types.ObjectId, nombre: String },
        motivo: String,
        fecha: Date
    },
    edificio: { type: String, required: true },
    espacio: String,
    etiquetas: { type: [String], default: [] },
    datosCategoria: { type: Schema.Types.Mixed, default: {} },
    reportante: { id: Schema.Types.ObjectId, nombre: String, email: String },
    tecnico: { id: Schema.Types.ObjectId, nombre: String },
    evidencias: [{ path: String, nombre: String, tipo: String, size: Number, subidoPor: String, fecha: { type: Date, default: Date.now } }],
    historial: [{
        tipo: String,
        autor: String,
        rol: String,
        comentario: String,
        horas: Number,
        estadoAnterior: String,
        estadoNuevo: String,
        fecha: { type: Date, default: Date.now }
    }],
    horasTotales: { type: Number, default: 0 },
    fechaResolucion: Date,
    // 'demo' marca los datos de demostración para separarlos de los reales
    origen: String
}, { timestamps: true, collection: 'incidencias' });

// Búsqueda textual en español con ponderación: el título pesa 10, la descripción 3
incSchema.index({ titulo: 'text', descripcion: 'text' }, { weights: { titulo: 10, descripcion: 3 }, default_language: 'spanish', name: 'texto_incidencias' });
incSchema.index({ categoria: 1, estado: 1, edificio: 1 });
incSchema.index({ estado: 1, prioridad: 1, createdAt: -1 });
incSchema.index({ 'autorizacion.estado': 1, estado: 1 });
incSchema.index({ etiquetas: 1 });
incSchema.index({ edificio: 1 });
incSchema.index({ 'reportante.id': 1 });
incSchema.index({ 'tecnico.id': 1, estado: 1 });

// Validador $jsonSchema del expediente (CU-01 paso 3 y RNF-02). Se declara aparte para poder
// instalarlo, relajarlo o retirarlo sin tocar el schema de Mongoose.
export const VALIDADOR_INCIDENCIA = {
    bsonType: 'object',
    additionalProperties: true,
    required: ['titulo', 'descripcion', 'categoria', 'prioridad', 'estado', 'edificio'],
    properties: {
        titulo: { bsonType: 'string', minLength: 5, maxLength: 80 },
        descripcion: { bsonType: 'string', minLength: 10, maxLength: 4000 },
        categoria: { enum: CATS },
        prioridad: { enum: PRIOS },
        estado: { enum: ESTADOS },
        edificio: { bsonType: 'string', minLength: 1, maxLength: 80 },
        etiquetas: { bsonType: 'array', maxItems: 10, items: { bsonType: 'string' } },
        horasTotales: { bsonType: ['int', 'long', 'double', 'decimal'], minimum: 0 },
        autorizacion: { bsonType: 'object', properties: { estado: { enum: AUT_ESTADOS } } }
    },
    // El polimorfismo: cada categoría exige su propio conjunto de campos dentro de datosCategoria.
    // oneOf va en la raíz del schema, no dentro de properties.
    oneOf: CATS.map(c => ({
        properties: {
            categoria: { enum: [c] },
            datosCategoria: { bsonType: 'object', required: CAMPOS_CATEGORIA[c].req }
        }
    }))
};

export const Inc = model('Incidencia', incSchema);

const normDatos = (categoria, bruto) => {
    const cfg = CAMPOS_CATEGORIA[categoria];
    if (!cfg) return { error: 'Categoría no reconocida' };
    const src = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
    const lim = {};
    for (const k of [...cfg.req, ...cfg.opt]) {
        if (src[k] === undefined || src[k] === null || src[k] === '') continue;
        lim[k] = typeof src[k] === 'boolean' ? src[k] : String(src[k]).slice(0, 160);
    }
    for (const k of cfg.req) if (!lim[k]) return { error: `Faltan campos de la categoría: ${cfg.req.join(', ')}` };
    if (lim.vlan !== undefined) {
        const n = Number(lim.vlan);
        if (!Number.isInteger(n) || n < 1 || n > 4094) return { error: 'vlan debe ser un entero entre 1 y 4094' };
        lim.vlan = n;
    }
    if (lim.direccion_ip !== undefined) {
        const oct = String(lim.direccion_ip).split('.');
        if (oct.length !== 4 || !oct.every(o => /^\d{1,3}$/.test(o)) || oct.some(o => +o > 255)) return { error: 'direccion_ip no es válida' };
    }
    return { datos: lim };
};

// Un solo normalizador de etiquetas: minúsculas, sin #, sin duplicados, máximo 10
export const limpiarEtiquetas = a => Array.isArray(a)
    ? [...new Set(a.map(t => String(t).replace('#', '').trim().toLowerCase()).filter(Boolean))].slice(0, 10)
    : [];

// Único generador de folio (lo usan la API y la siembra de demostración sobre el mismo contador).
export const siguienteFolio = async (fecha = new Date()) => {
    const c = await Counter.findOneAndUpdate({ _id: 'folio' }, { $inc: { n: 1 } }, { upsert: true, new: true });
    return `UTM-${fecha.getFullYear()}-${String(c.n).padStart(4, '0')}`;
};

const puedeVer = (user, d) => {
    if (user.rol === 'soporte_ti') return true;
    if (user.rol === 'tecnico') return String(d.tecnico?.id || '') === user.id;
    if (user.rol === 'reportante') return String(d.reportante?.id || '') === user.id;
    return false; // directivo: solo agregados
};

// Carga el expediente y aplica el filtro de visibilidad: el mismo control que repetían siete rutas.
const revisar = async (id, user) => {
    const d = await Inc.findById(id);
    if (!d) return { status: 404, error: 'No encontrada' };
    if (!puedeVer(user, d)) return { status: 403, error: 'No tienes permisos sobre esta incidencia' };
    return { d };
};

// Estados que ya no admiten trabajo: se derivan de la máquina de estados, no de una lista suelta.
const TERMINADAS = ESTADOS.filter(e => TRANSICIONES[e].length === 0 || e === 'Resuelta');

const scope = user =>
    user.rol === 'tecnico' ? { 'tecnico.id': new mongoose.Types.ObjectId(user.id) }
        : user.rol === 'reportante' ? { 'reportante.id': new mongoose.Types.ObjectId(user.id) }
            : {};

const FILTROS = ['estado', 'categoria', 'prioridad', 'edificio'];
const ENUMS = { estado: ESTADOS, categoria: CATS, prioridad: PRIOS };

// Rango de fechas compartido entre el listado, las exportaciones y la analítica.
const rangoFechas = query => {
    if (!query.desde && !query.hasta) return null;
    const r = {};
    if (query.desde) r.$gte = new Date(String(query.desde));
    if (query.hasta) r.$lte = new Date(String(query.hasta) + 'T23:59:59.999');
    return r;
};

export function createApp(cfg = {}) {
    const {
        jwtSecret = process.env.JWT_SECRET,
        bucket = process.env.SUPABASE_BUCKET || 'evidencias',
        corsOrigins = (process.env.CLIENT_URL || 'http://localhost:5173,http://localhost:5174').split(',').map(s => s.trim()).filter(Boolean),
        storage = null,
        ttlDias = Number(process.env.TTL_DIAS ?? 60)
    } = cfg;

    if (!jwtSecret) throw new Error('JWT_SECRET no está configurado');

    const sb = storage || clienteSupabase();

    const app = express();
    app.disable('x-powered-by');
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({ origin: corsOrigins.length ? corsOrigins : false }));
    app.use(express.json({ limit: '1mb' }));

    const h = f => (q, s, n) => Promise.resolve(f(q, s, n)).catch(n);

    const auth = (...roles) => (req, res, next) => {
        const head = req.headers.authorization || '';
        const token = head.startsWith('Bearer ') ? head.slice(7) : head;
        if (!token) return res.status(401).json({ error: 'Sesión inválida' });
        try {
            req.user = jwt.verify(token, jwtSecret);
        } catch {
            return res.status(401).json({ error: 'Sesión inválida' });
        }
        const rolToken = rolEfectivo(req.user.rol);
        if (!ROLES.includes(rolToken)) return res.status(403).json({ error: 'Rol no reconocido' });
        if (roles.length && !roles.includes(rolToken)) return res.status(403).json({ error: 'No tienes permisos' });
        // El rol del token es solo una pista: se revalida contra la base para que un cambio de rol surta al instante
        User.findById(req.user.id).lean().then(u => {
            if (!u) return res.status(401).json({ error: 'Sesión inválida' });
            req.user.rol = rolEfectivo(u.rol);
            if (roles.length && !roles.includes(req.user.rol)) return res.status(403).json({ error: 'No tienes permisos' });
            next();
        }).catch(next);
    };

    const firmar = u => jwt.sign({ id: String(u._id), nombre: u.nombre, email: u.email, rol: rolEfectivo(u.rol) }, jwtSecret, { expiresIn: '8h' });
    const pub = u => ({
        id: u._id, nombre: u.nombre, email: u.email, rol: rolEfectivo(u.rol),
        creadoEn: u.createdAt || null, ultimoAcceso: u.ultimoAcceso || null
    });
    const firmarURL = async e => ({ ...e, url: sb ? (await sb.storage.from(bucket).createSignedUrl(e.path, 3600)).data?.signedUrl ?? null : null });

    const validarRegistro = ({ nombre, email, password }) => {
        if (typeof nombre !== 'string' || nombre.trim().length < 3) return 'El nombre debe tener al menos 3 caracteres';
        if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) return 'Correo inválido';
        if (typeof password !== 'string' || password.length < 8 || password.length > 72) return 'La contraseña debe tener entre 8 y 72 caracteres';
        return null;
    };

    const limiteAuth = rateLimit({
        windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE || 10),
        standardHeaders: true, legacyHeaders: false,
        message: { error: 'Demasiados intentos, intenta en unos minutos' }
    });

    // ---- AUTH ----
    app.post('/api/auth/register', limiteAuth, h(async (q, s) => {
        const err = validarRegistro(q.body || {});
        if (err) return s.status(400).json({ error: err });
        if (await User.exists({ email: q.body.email.toLowerCase() })) return s.status(409).json({ error: 'El correo ya está registrado' });
        const u = await User.create({ nombre: q.body.nombre.trim(), email: q.body.email, password: await bcrypt.hash(q.body.password, 10), rol: 'reportante' });
        s.status(201).json({ token: firmar(u), user: pub(u) });
    }));

    app.post('/api/auth/login', limiteAuth, h(async (q, s) => {
        const email = typeof q.body?.email === 'string' ? q.body.email.toLowerCase() : '';
        const password = typeof q.body?.password === 'string' ? q.body.password : '';
        const u = await User.findOne({ email }).select('+password');
        const ok = u && await bcrypt.compare(password, u.password);
        if (!ok) return s.status(401).json({ error: 'Credenciales incorrectas' });
        // Se registra la sesión para el panel de administración
        u.ultimoAcceso = new Date();
        await u.save({ validateBeforeSave: false });
        s.json({ token: firmar(u), user: pub(u) });
    }));

    app.get('/api/auth/me', auth(), h(async (q, s) => {
        // Se responde desde la base: pub() espera un documento y el payload del token usa "id", no "_id"
        const u = await User.findById(q.user.id).lean();
        s.json(pub(u));
    }));

    // ---- USUARIOS ----
    app.post('/api/users', auth('soporte_ti'), h(async (q, s) => {
        const { nombre, email, password } = q.body || {};
        const rol = rolEfectivo(q.body?.rol);
        const err = validarRegistro(q.body || {}) || (!ROLES.includes(rol) || rol === 'reportante' ? 'Rol no válido' : null);
        if (err) return s.status(400).json({ error: err });
        if (await User.exists({ email: email.toLowerCase() })) return s.status(409).json({ error: 'El correo ya está registrado' });
        const u = await User.create({ nombre: nombre.trim(), email, password: await bcrypt.hash(password, 10), rol });
        s.status(201).json(pub(u));
    }));

    app.get('/api/users', auth('soporte_ti'), h(async (q, s) => s.json((await User.find().sort({ createdAt: 1 })).map(pub))));

    app.patch('/api/users/:id/rol', auth('soporte_ti'), h(async (q, s) => {
        const rol = rolEfectivo(q.body?.rol);
        if (!ROLES.includes(rol)) return s.status(400).json({ error: 'Rol no válido' });
        if (String(q.params.id) === String(q.user.id)) return s.status(400).json({ error: 'No puedes cambiar tu propio rol' });
        const u = await User.findById(q.params.id);
        if (!u) return s.status(404).json({ error: 'Usuario no encontrado' });
        if (rolEfectivo(u.rol) === rol) return s.status(400).json({ error: `La cuenta ya tiene el rol ${rol}` });
        u.rol = rol;
        await u.save();
        s.json(pub(u));
    }));

    // Baja de cuentas: las incidencias conservan la copia desnormalizada de reportante y técnico,
    // por eso borrar un usuario no rompe la trazabilidad de los expedientes ya abiertos.
    // La única cuenta que nunca se puede eliminar es la propia, y eso ya garantiza que
    // siempre quede al menos un Soporte TI (quien borra lo es).
    app.delete('/api/users/:id', auth('soporte_ti'), h(async (q, s) => {
        const u = await User.findById(q.params.id);
        if (!u) return s.status(404).json({ error: 'Usuario no encontrado' });
        if (String(u._id) === String(q.user.id)) return s.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
        await u.deleteOne();
        s.json({ eliminado: pub(u) });
    }));

    app.get('/api/tecnicos', auth('tecnico', 'soporte_ti'), h(async (q, s) => {
        s.json((await User.find({ rol: 'tecnico' })).map(pub));
    }));

    // ---- INCIDENCIAS ----
    const filtrosQuery = q => {
        const f = {};
        for (const k of FILTROS) {
            if (!q.query[k]) continue;
            // Se acepta en cualquier mayúscula, pero se consulta el valor canónico del enum
            if (ENUMS[k]) {
                const exacto = ENUMS[k].find(v => estadoIgual(v, q.query[k]));
                if (!exacto) { const e = new Error('Filtro no válido'); e.status = 400; throw e; }
                f[k] = exacto;
            } else f[k] = String(q.query[k]).trim();
        }
        if (q.query.q) f.$text = { $search: String(q.query.q).slice(0, 120) };
        if (q.query.etiqueta) f.etiquetas = String(q.query.etiqueta).replace('#', '').trim().toLowerCase();
        if (q.query.autorizacion) {
            if (!AUT_ESTADOS.includes(q.query.autorizacion)) { const e = new Error('Filtro de autorización no válido'); e.status = 400; throw e; }
            f['autorizacion.estado'] = q.query.autorizacion;
        }
        const rango = rangoFechas(q.query);
        if (rango) f.createdAt = rango;
        return f;
    };

    app.get('/api/incidencias', auth('reportante', 'tecnico', 'soporte_ti'), h(async (q, s) => {
        const f = { ...filtrosQuery(q), ...scope(q.user) };
        const L = Math.min(Math.max(parseInt(q.query.limit, 10) || 10, 1), 50);
        const page = Math.max(parseInt(q.query.page, 10) || 1, 1);
        // CU-05: con búsqueda textual se proyecta el score del índice y se ordena por relevancia
        const textual = Boolean(f.$text);
        const [items, total] = await Promise.all([
            Inc.find(f, textual ? { historial: 0, score: { $meta: 'textScore' } } : { historial: 0 })
                .sort(textual ? { score: { $meta: 'textScore' } } : { createdAt: -1 })
                .skip((page - 1) * L).limit(L).lean(),
            Inc.countDocuments(f)
        ]);
        s.json({ items, total, pages: Math.ceil(total / L), page });
    }));

    const TIPOS_EVIDENCIA = ['image/jpeg', 'image/png', 'application/pdf'];

    const up = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 15e6, files: 5 },
        // multer descarta en silencio lo que no acepta; se cuenta para poder avisar al cliente
        fileFilter: (r, f, cb) => {
            const ok = TIPOS_EVIDENCIA.includes(f.mimetype);
            if (!ok) r.evidenciasRechazadas = (r.evidenciasRechazadas || 0) + 1;
            cb(null, ok);
        }
    });

    const subir = async (files, folio, autor) => {
        const out = [];
        for (const f of files || []) {
            if (!sb) { const e = new Error('Almacenamiento no configurado'); e.status = 503; throw e; }
            const path = `${folio}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${f.originalname.replace(/[^\w.-]/g, '_')}`;
            const { error } = await sb.storage.from(bucket).upload(path, f.buffer, { contentType: f.mimetype });
            if (error) { const e = new Error('Falló la subida de archivos'); e.status = 502; throw e; }
            out.push({ path, nombre: f.originalname.slice(0, 120), tipo: f.mimetype, size: f.size, subidoPor: autor });
        }
        return out;
    };

    const validarEvidencias = q => {
        if (!q.evidenciasRechazadas) return;
        const e = new Error(`Las evidencias deben ser JPG, PNG o PDF (se descartaron ${q.evidenciasRechazadas} archivo(s))`);
        e.status = 400;
        throw e;
    };

    app.post('/api/incidencias', auth('reportante', 'soporte_ti'), up.array('evidencias', 5), h(async (q, s) => {
        const b = q.body || {};
        validarEvidencias(q);
        let tags = [];
        try {
            const parseo = JSON.parse(b.etiquetas || '[]');
            if (!Array.isArray(parseo)) throw 0;
            tags = limpiarEtiquetas(parseo);
        } catch { return s.status(400).json({ error: 'etiquetas debe ser un arreglo JSON' }); }

        const titulo = (b.titulo || '').trim();
        if (titulo.length < 5 || titulo.length > 80) return s.status(400).json({ error: 'El título debe medir entre 5 y 80 caracteres' });
        if ((b.descripcion || '').trim().length < 10) return s.status(400).json({ error: 'La descripción debe tener al menos 10 caracteres' });
        if (!CATS.includes(b.categoria)) return s.status(400).json({ error: 'Categoría no válida' });
        if (!PRIOS.includes(b.prioridad)) return s.status(400).json({ error: 'Prioridad no válida' });
        if (!(b.edificio || '').trim()) return s.status(400).json({ error: 'El edificio es obligatorio' });

        let bruto;
        try { bruto = JSON.parse(b.datosCategoria || '{}'); } catch { return s.status(400).json({ error: 'datosCategoria debe ser un objeto JSON' }); }
        const cat = normDatos(b.categoria, bruto);
        if (cat.error) return s.status(400).json({ error: cat.error });

        const folio = await siguienteFolio();
        const evidencias = await subir(q.files, folio, q.user.nombre);

        const d = await Inc.create({
            folio, titulo, descripcion: (b.descripcion || '').trim(), categoria: b.categoria, prioridad: b.prioridad,
            edificio: b.edificio.trim(), espacio: (b.espacio || '').trim(), etiquetas: tags, datosCategoria: cat.datos, evidencias,
            reportante: { id: q.user.id, nombre: q.user.nombre, email: q.user.email },
            historial: [{ tipo: 'creacion', autor: q.user.nombre, rol: q.user.rol, comentario: 'Incidencia registrada', estadoNuevo: 'Abierta' }]
        });
        s.status(201).json(d);
    }));

    app.get('/api/incidencias/export', auth('soporte_ti'), h(async (q, s) => {
        s.json(await Inc.find(filtrosQuery(q)).sort({ createdAt: -1 }).limit(5000).lean());
    }));

    app.get('/api/incidencias/:id', auth('reportante', 'tecnico', 'soporte_ti'), h(async (q, s) => {
        const r = await revisar(q.params.id, q.user);
        if (r.error) return s.status(r.status).json({ error: r.error });
        const o = r.d.toObject();
        o.evidencias = await Promise.all(o.evidencias.map(firmarURL));
        s.json(o);
    }));

    app.patch('/api/incidencias/:id/estado', auth('tecnico', 'soporte_ti'), h(async (q, s) => {
        const { estado, comentario } = q.body || {};
        if (!ESTADOS.some(v => estadoIgual(v, estado))) return s.status(400).json({ error: 'Estado no válido' });
        const destino = ESTADOS.find(v => estadoIgual(v, estado));

        const r = await revisar(q.params.id, q.user);
        if (r.error) return s.status(r.status).json({ error: r.error });
        const d = r.d;
        if (!TRANSICIONES[d.estado].includes(destino)) return s.status(400).json({ error: `Transición no permitida: ${d.estado} → ${destino}` });
        if (destino === 'Cerrada' && !PUEDE_CERRAR.includes(q.user.rol)) return s.status(403).json({ error: 'Solo Soporte TI puede cerrar incidencias' });
        if (destino === 'Resuelta' && !PUEDE_RESOLVER.includes(q.user.rol)) return s.status(403).json({ error: 'Tu rol no puede resolver incidencias' });
        // Ninguna incidencia sin decisión de Soporte TI entra en la cola operativa (RF-06)
        if (d.autorizacion.estado === 'pendiente') return s.status(409).json({ error: 'Primero se debe autorizar o rechazar la incidencia' });
        if (!String(comentario || '').trim()) return s.status(400).json({ error: 'Indica un comentario para dejar trazada la intervención' });

        const anterior = d.estado;
        const cambios = { $set: { estado: destino } };
        // CU-03: la fecha de resolución solo se asienta al resolver; cerrar no es resolver
        if (destino === 'Resuelta' && !d.fechaResolucion) cambios.$set.fechaResolucion = new Date();
        if (destino === 'En proceso') cambios.$set.fechaResolucion = null;
        cambios.$push = { historial: { tipo: 'estado', autor: q.user.nombre, rol: q.user.rol, comentario: String(comentario).slice(0, 1000), estadoAnterior: anterior, estadoNuevo: destino } };
        s.json(await Inc.findByIdAndUpdate(q.params.id, cambios, { new: true }));
    }));

    // ---- Autorización / rechazo (RF-06 y RF-07) ----
    app.patch('/api/incidencias/:id/autorizacion', auth('soporte_ti'), h(async (q, s) => {
        const { accion, motivo } = q.body || {};
        if (!['aprobar', 'rechazar'].includes(accion)) return s.status(400).json({ error: 'La acción debe ser aprobar o rechazar' });
        if (accion === 'rechazar' && !(motivo || '').trim()) return s.status(400).json({ error: 'El rechazo requiere motivo' });

        const d = await Inc.findById(q.params.id);
        if (!d) return s.status(404).json({ error: 'No encontrada' });
        if (d.autorizacion.estado !== 'pendiente') return s.status(409).json({ error: 'Esta incidencia ya fue autorizada o rechazada' });

        const nueva = accion === 'aprobar' ? 'aprobada' : 'rechazada';
        const cambios = {
            $set: { 'autorizacion.estado': nueva, 'autorizacion.por': { id: q.user.id, nombre: q.user.nombre }, 'autorizacion.motivo': (motivo || '').slice(0, 500), 'autorizacion.fecha': new Date() },
            $push: { historial: { tipo: 'autorizacion', autor: q.user.nombre, rol: q.user.rol, comentario: `Solicitud ${nueva}${motivo ? ': ' + motivo : ''}` } }
        };
        // El rechazo cierra el expediente sin fecha de resolución: no se atendió, así que no
        // contaminó el tiempo medio de resolución ni activa la depuración TTL del CU-07.
        if (nueva === 'rechazada' && TRANSICIONES[d.estado].includes('Cerrada')) {
            cambios.$set.estado = 'Cerrada';
            cambios.$push.historial.estadoAnterior = d.estado;
            cambios.$push.historial.estadoNuevo = 'Cerrada';
        }
        s.json(await Inc.findByIdAndUpdate(q.params.id, cambios, { new: true }));
    }));

    app.post('/api/incidencias/:id/intervenciones', auth('tecnico', 'soporte_ti'), h(async (q, s) => {
        const { comentario, horas } = q.body || {};
        const h2 = Number(horas);
        if (!(comentario || '').trim()) return s.status(400).json({ error: 'El comentario es obligatorio' });
        if (!Number.isFinite(h2) || h2 < 0 || h2 > 24) return s.status(400).json({ error: 'Las horas deben estar entre 0 y 24' });

        const r = await revisar(q.params.id, q.user);
        if (r.error) return s.status(r.status).json({ error: r.error });

        s.json(await Inc.findByIdAndUpdate(q.params.id, {
            $inc: { horasTotales: h2 },
            $push: { historial: { tipo: 'intervencion', autor: q.user.nombre, rol: q.user.rol, comentario: String(comentario).slice(0, 1000), horas: h2 } }
        }, { new: true }));
    }));

    app.patch('/api/incidencias/:id/asignar', auth('soporte_ti'), h(async (q, s) => {
        const t = await User.findOne({ _id: q.body?.tecnicoId, rol: 'tecnico' });
        if (!t) return s.status(400).json({ error: 'Técnico inválido' });
        const d = await Inc.findById(q.params.id);
        if (!d) return s.status(404).json({ error: 'No encontrada' });
        if (d.autorizacion.estado !== 'aprobada') return s.status(409).json({ error: 'Solo se asignan incidencias autorizadas' });
        if (TERMINADAS.includes(d.estado)) return s.status(409).json({ error: 'La incidencia ya terminó' });
        s.json(await Inc.findByIdAndUpdate(q.params.id, {
            $set: { tecnico: { id: t._id, nombre: t.nombre } },
            $push: { historial: { tipo: 'asignacion', autor: q.user.nombre, rol: q.user.rol, comentario: `Asignada a ${t.nombre}` } }
        }, { new: true }));
    }));

    app.patch('/api/incidencias/:id/prioridad', auth('soporte_ti'), h(async (q, s) => {
        const { prioridad, comentario } = q.body || {};
        if (!PRIOS.includes(prioridad)) return s.status(400).json({ error: 'Prioridad no válida' });
        const d = await Inc.findById(q.params.id);
        if (!d) return s.status(404).json({ error: 'No encontrada' });
        if (d.estado === 'Cerrada') return s.status(409).json({ error: 'Una incidencia cerrada no recalifica su prioridad' });
        s.json(await Inc.findByIdAndUpdate(q.params.id, {
            $set: { prioridad },
            $push: { historial: { tipo: 'prioridad', autor: q.user.nombre, rol: q.user.rol, comentario: (comentario || `Prioridad cambiada a ${prioridad}`).slice(0, 1000) } }
        }, { new: true }));
    }));

    // $addToSet / $pull: etiquetas sin duplicados y sin reescribir el arreglo completo.
    // Actores del CU-04: técnico asignado y Soporte TI; el reportante no recalifica descriptores.
    app.patch('/api/incidencias/:id/etiquetas', auth('tecnico', 'soporte_ti'), h(async (q, s) => {
        const { agregar, quitar } = q.body || {};
        const [mas, menos] = [limpiarEtiquetas(agregar), limpiarEtiquetas(quitar)];
        if (!mas.length && !menos.length) return s.status(400).json({ error: 'Indica etiquetas a agregar o quitar' });

        const r = await revisar(q.params.id, q.user);
        if (r.error) return s.status(r.status).json({ error: r.error });
        const nuevas = mas.filter(t => !r.d.etiquetas.includes(t));
        if (r.d.etiquetas.length - menos.filter(t => r.d.etiquetas.includes(t)).length + nuevas.length > 10) {
            return s.status(400).json({ error: 'Un expediente admite como máximo 10 etiquetas' });
        }

        const op = [];
        if (mas.length) op.push({ $addToSet: { etiquetas: { $each: mas } } });
        if (menos.length) op.push({ $pull: { etiquetas: { $in: menos } } });
        let res = null;
        for (const p of op) res = await Inc.findByIdAndUpdate(q.params.id, p, { new: true });
        s.json(res);
    }));

    // Ampliación de evidencias: reportante dueño, técnico asignado y Soporte TI (CU-02)
    app.post('/api/incidencias/:id/evidencias', auth('reportante', 'tecnico', 'soporte_ti'), up.array('evidencias', 5), h(async (q, s) => {
        const r = await revisar(q.params.id, q.user);
        if (r.error) return s.status(r.status).json({ error: r.error });
        const d = r.d;
        if (d.estado === 'Cerrada') return s.status(409).json({ error: 'Una incidencia cerrada no admite más evidencias' });
        validarEvidencias(q);
        const nuevas = await subir(q.files, d.folio, q.user.nombre);
        if (!nuevas.length) return s.status(400).json({ error: 'No se recibió ningún archivo válido' });
        for (const e of nuevas) e.subidoPor = q.user.nombre;
        s.status(201).json(await Inc.findByIdAndUpdate(q.params.id, {
            $push: { evidencias: { $each: nuevas }, historial: { tipo: 'evidencia', autor: q.user.nombre, rol: q.user.rol, comentario: `${nuevas.length} evidencia(s) adjuntadas` } }
        }, { new: true }));
    }));

    // ---- Excel ----
    app.get('/api/export/excel', auth('soporte_ti'), h(async (q, s) => {
        const f = filtrosQuery(q);
        const L = await Inc.find(f).sort({ createdAt: -1 }).limit(20000).lean();
        const wb = buildWorkbook(L, { ESTADOS, CATS, PRIOS }, Object.entries(q.query).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(', '));
        s.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        s.setHeader('Content-Disposition', 'attachment; filename="utm-desk-control.xlsx"');
        await wb.xlsx.write(s);
        s.end();
    }));

    // ---- Base de conocimiento ----
    app.get('/api/kb', auth('reportante', 'tecnico', 'soporte_ti', 'directivo'), h(async (q, s) => {
        const txt = String(q.query.q || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 80);
        const r = txt ? new RegExp(txt, 'i') : null;
        s.json(await Art.find(r ? { $or: [{ titulo: r }, { contenido: r }] } : {}).sort({ createdAt: -1 }).limit(100));
    }));

    app.post('/api/kb', auth('tecnico', 'soporte_ti'), h(async (q, s) => {
        const { titulo, contenido } = q.body || {};
        if ((titulo || '').trim().length < 5 || (contenido || '').trim().length < 10) return s.status(400).json({ error: 'Título (5+) y contenido (10+) obligatorios' });
        s.status(201).json(await Art.create({ titulo: titulo.trim(), contenido: contenido.trim(), autor: q.user.nombre }));
    }));

    app.delete('/api/kb/:id', auth('soporte_ti'), h(async (q, s) => {
        const r = await Art.findByIdAndDelete(q.params.id);
        if (!r) return s.status(404).json({ error: 'Artículo no encontrado' });
        s.json({ ok: true });
    }));

    // ---- Analítica: solo Soporte TI y Directivo ----
    app.get('/api/stats', auth('soporte_ti', 'directivo'), h(async (q, s) => {
        const f = {};
        const rango = rangoFechas(q.query);
        if (rango) f.createdAt = rango;
        // Pipeline 1 (CU-06): expedientes efectivamente resueltos. El rechazo no lleva fecha de
        // resolución y se excluye además por autorización, para no mezclar "atendido" con "descartado".
        const resueltas = { estado: { $in: TERMINADAS }, fechaResolucion: { $type: 'date' }, 'autorizacion.estado': { $ne: 'rechazada' } };
        // Un solo $facet en lugar de nueve agregaciones sobre el mismo filtro (RNF-03)
        const [agg] = await Inc.aggregate([
            { $match: f },
            {
                $facet: {
                    porEstado: [{ $group: { _id: '$estado', n: { $sum: 1 } } }],
                    tiempoPorEdificio: [
                        { $match: resueltas },
                        {
                            $group: {
                                _id: '$edificio',
                                horasPromedio: { $avg: { $divide: [{ $subtract: ['$fechaResolucion', '$createdAt'] }, 36e5] } },
                                horasTrabajadas: { $sum: '$horasTotales' },
                                n: { $sum: 1 }
                            }
                        },
                        { $project: { horasPromedio: { $round: ['$horasPromedio', 1] }, horasTrabajadas: { $round: ['$horasTrabajadas', 1] }, n: 1 } },
                        { $sort: { horasPromedio: -1 } }
                    ],
                    topEtiquetas: [{ $unwind: '$etiquetas' }, { $group: { _id: '$etiquetas', n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 10 }],
                    porCategoria: [{ $group: { _id: '$categoria', n: { $sum: 1 } } }],
                    porPrioridad: [{ $group: { _id: '$prioridad', n: { $sum: 1 } } }],
                    porEdificio: [{ $group: { _id: '$edificio', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
                    carga: [{ $match: { estado: { $nin: TERMINADAS } } }, { $group: { _id: '$edificio', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
                    tendencia: [
                        { $group: { _id: { anio: { $year: '$createdAt' }, mes: { $month: '$createdAt' } }, n: { $sum: 1 } } },
                        { $sort: { '_id.anio': 1, '_id.mes': 1 } },
                        { $project: { _id: 0, anio: '$_id.anio', mes: '$_id.mes', n: 1 } }
                    ],
                    totales: [
                        { $group: { _id: null, total: { $sum: 1 }, horasSum: { $sum: '$horasTotales' }, pendientes: { $sum: { $cond: [{ $eq: ['$autorizacion.estado', 'pendiente'] }, 1, 0] } } } },
                        { $project: { _id: 0, total: 1, horasSum: { $round: ['$horasSum', 1] }, pendientes: 1 } }
                    ]
                }
            }
        ]);
        const { totales, ...secciones } = agg || { totales: [], porEstado: [], tiempoPorEdificio: [], topEtiquetas: [], porCategoria: [], porPrioridad: [], porEdificio: [], carga: [], tendencia: [] };
        s.json({
            totales: totales[0] || { total: 0, horasSum: 0, pendientes: 0 },
            ...secciones,
            actualizado: new Date()
        });
    }));

    app.use((q, s) => s.status(404).json({ error: 'Recurso no encontrado' }));

    app.use((e, q, s, n) => {
        if (e.type === 'entity.too.large') return s.status(413).json({ error: 'Solicitud demasiado grande' });
        if (e.code === 'LIMIT_UNEXPECTED_FILE') return s.status(400).json({ error: 'Envía los archivos en el campo "evidencias"' });
        if (e.code === 'LIMIT_FILE_SIZE') return s.status(413).json({ error: 'Cada evidencia debe pesar menos de 15 MB' });
        if (e.code === 'LIMIT_FILE_COUNT') return s.status(400).json({ error: 'Máximo 5 evidencias por solicitud' });
        if (e.status) return s.status(e.status).json({ error: e.message });
        if (e.name === 'CastError' || e.name === 'ValidationError') return s.status(400).json({ error: 'Datos no válidos' });
        if (e.code === 11000) return s.status(409).json({ error: 'Ya existe un registro con ese dato' });
        console.error(e);
        s.status(500).json({ error: 'Error interno del servidor' });
    });

    return app;
}

export async function ensureIndexes(ttlDias = Number(process.env.TTL_DIAS ?? 60)) {
    // syncIndexes() elimina los índices que no vienen del schema, así que el TTL se crea después.
    await Inc.syncIndexes().catch(err => {
        console.warn('⚠️  Aviso: Error al sincronizar índices:', err.message);
    });

    const expira = ttlDias > 0;
    if (expira) {
        // Un índice TTL existente con otras opciones no se puede modificar: se retira y se vuelve a crear.
        await Inc.collection.dropIndex('ttl_resolucion').catch(() => {});
        await Inc.collection.dropIndex('fechaResolucion_1').catch(() => {});
        await Inc.collection.createIndex(
            { fechaResolucion: 1 },
            { expireAfterSeconds: ttlDias * 24 * 3600, name: 'ttl_resolucion' }
        );
    } else {
        await Inc.collection.dropIndex('ttl_resolucion').catch(() => {});
        await Inc.collection.dropIndex('fechaResolucion_1').catch(() => {});
    }

    const validador = await aplicarValidador();
    return { ttlActivo: expira, dias: ttlDias, ...validador };
}

// Instala (o retira) el validador $jsonSchema sobre la colección real de Atlas.
// JSON_SCHEMA=off lo desactiva; JSON_SCHEMA=moderate solo valida actualizaciones, para
// no bloquear documentos heredados con campos de fases anteriores.
export async function aplicarValidador() {
    const nivel = process.env.JSON_SCHEMA === 'off' ? 'off'
        : process.env.JSON_SCHEMA === 'moderate' ? 'moderate' : 'strict';
    try {
        await mongoose.connection.db.command({
            collMod: Inc.collection.name,
            validator: nivel === 'off' ? {} : { $jsonSchema: VALIDADOR_INCIDENCIA },
            validationLevel: nivel,
            validationAction: 'error'
        });
        return { validador: nivel };
    } catch (err) {
        console.warn('⚠️  No se pudo aplicar el validador $jsonSchema:', err.message);
        return { validador: 'sin instalar' };
    }
}

const FAQ = [
    { titulo: 'No tengo conexión a la red UTM-WiFi', contenido: '1. Olvida la red y vuelve a conectarte.\n2. Verifica que tu cuenta institucional esté activa.', autor: 'Sistema' },
    { titulo: 'El proyector del aula no enciende', contenido: 'Revisa el cable de corriente y HDMI, y confirma la fuente en el panel de control.', autor: 'Sistema' },
    { titulo: 'No puedo entrar al portal académico (SISE)', contenido: 'Restablece tu contraseña desde el portal institucional o contacta a Soporte TI.', autor: 'Sistema' },
    { titulo: '¿Cuánto tarda la atención de mi reporte?', contenido: 'Según prioridad (SLA): Baja 48h, Media 24h, Alta 8h, Urgente menos de 2h.', autor: 'Sistema' }
];

// Los perfiles creados antes de activar timestamps no traen fecha de registro; el ObjectId sí la lleva.
// Se escribe por el driver nativo porque Mongoose marca createdAt como inmutable una vez creado el documento.
export const sincronizarFechasDeRegistro = async () => {
    const sinFecha = await User.find({ createdAt: null }).select('_id').lean();
    for (const u of sinFecha) await User.collection.updateOne({ _id: u._id, createdAt: null }, { $set: { createdAt: u._id.getTimestamp() } });
    return sinFecha.length;
};

export async function bootstrap({ uri = process.env.MONGODB_URI, ttlDias } = {}) {
    if (!uri) throw new Error('MONGODB_URI no está configurado');
    await mongoose.connect(uri);
    await ensureIndexes(ttlDias);

    // Migración de roles heredados: usuario→reportante, admin→soporte_ti
    const migrados = await User.updateMany({ rol: 'usuario' }, { $set: { rol: 'reportante' } });
    const migrados2 = await User.updateMany({ rol: 'admin' }, { $set: { rol: 'soporte_ti' } });

    // La cuenta de .env se crea si falta y se asciende a Soporte TI si aún figura como "admin".
    // La contraseña NO se reescribe en cada arranque: eso permitiría tomar cualquier cuenta
    // privilegiada solo con editar el .env. Se resetea de forma explícita con RESET_ADMIN_PASSWORD=1.
    const email = process.env.ADMIN_EMAIL;
    const pass = process.env.ADMIN_PASSWORD;
    if (email && pass) {
        const existente = await User.findOne({ email: String(email).toLowerCase() }).select('+password');
        if (!existente) {
            await User.create({ nombre: 'Soporte TI', email, password: await bcrypt.hash(pass, 10), rol: 'soporte_ti' });
            console.log(`🔑 Cuenta de Soporte TI creada: ${email}`);
        } else {
            const cambios = {};
            if (rolEfectivo(existente.rol) !== 'soporte_ti') cambios.rol = 'soporte_ti';
            if (process.env.RESET_ADMIN_PASSWORD === '1'
                && !(await bcrypt.compare(pass, existente.password || ''))) cambios.password = await bcrypt.hash(pass, 10);
            if (Object.keys(cambios).length) {
                const aviso = [];
                if (cambios.rol) aviso.push(`rol "${existente.rol}" → soporte_ti`);
                if (cambios.password) aviso.push('contraseña restablecida con RESET_ADMIN_PASSWORD=1');
                await User.findByIdAndUpdate(existente._id, { $set: cambios });
                console.log(`🔁 ${email}: ${aviso.join(', ')}`);
            } else {
                console.log(`✅ Cuenta de Soporte TI disponible: ${email}`);
            }
        }
    } else if (!await User.exists({ rol: 'soporte_ti' })) {
        console.warn('⚠️  No hay cuenta de Soporte TI. Define ADMIN_EMAIL y ADMIN_PASSWORD en .env y reinicia para crearla.');
    }

    await sincronizarFechasDeRegistro();

    if (!await Art.countDocuments()) await Art.insertMany(FAQ);

    return {
        rolesMigrados: migrados.modifiedCount + migrados2.modifiedCount,
        faqCreada: true
    };
}

if (process.env.NODE_ENV !== 'test' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const r = await bootstrap();
        if (r.rolesMigrados) console.log(`🔄 ${r.rolesMigrados} cuentas migradas a los roles oficiales`);
        const ttl = Number(process.env.TTL_DIAS ?? 60);
        console.log(ttl > 0 ? `⏳ TTL activo: las incidencias se depuran ${ttl} días después de su resolución` : '⏳ TTL desactivado (TTL_DIAS=0)');
        const app = createApp();
        app.listen(process.env.PORT || 4000, () => console.log('✅ API lista en puerto ' + (process.env.PORT || 4000)));
    } catch (err) {
        console.error('❌ Error al iniciar:', err.message);
        process.exit(1);
    }
}
