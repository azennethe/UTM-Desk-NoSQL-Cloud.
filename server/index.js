import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { buildWorkbook } from './excel.js';
import { createClient } from '@supabase/supabase-js';

const { Schema, model } = mongoose;

const ESTADOS = ['Abierta', 'En proceso', 'En espera', 'Resuelta', 'Cerrada'];
const PRIOS = ['Baja', 'Media', 'Alta', 'Urgente'];
const CATS = ['Cómputo y telecomunicaciones', 'Infraestructura física y mantenimiento', 'Sistemas y servicios académicos'];

const User = model('User', new Schema({
    nombre: String,
    email: { type: String, unique: true, lowercase: true },
    password: String,
    rol: { type: String, enum: ['usuario', 'tecnico', 'admin'], default: 'usuario' }
}));

const Counter = model('Counter', new Schema({ _id: String, n: Number }));

const Art = model('Articulo', new Schema({
    titulo: String,
    contenido: String,
    autor: String
}, { timestamps: true }));

const incSchema = new Schema({
    folio: { type: String, unique: true },
    titulo: { type: String, required: true, maxlength: 80 },
    descripcion: { type: String, required: true },
    categoria: { type: String, enum: CATS },
    prioridad: { type: String, enum: PRIOS },
    estado: { type: String, enum: ESTADOS, default: 'Abierta' },
    edificio: String,
    espacio: String,
    etiquetas: [String],
    datosCategoria: Schema.Types.Mixed,
    reportante: { id: Schema.Types.ObjectId, nombre: String, email: String },
    tecnico: { id: Schema.Types.ObjectId, nombre: String },
    evidencias: [{ path: String, nombre: String, tipo: String, size: Number }],
    historial: [{ 
        tipo: String, 
        autor: String, 
        comentario: String, 
        horas: Number, 
        estadoAnterior: String, 
        estadoNuevo: String, 
        fecha: { type: Date, default: Date.now } 
    }],
    fechaResolucion: Date
}, { timestamps: true });

incSchema.index({ titulo: 'text', descripcion: 'text' }, { weights: { titulo: 5, descripcion: 2 } });
incSchema.index({ etiquetas: 1 });
incSchema.index({ estado: 1, prioridad: 1, createdAt: -1 });
incSchema.index({ edificio: 1 });
incSchema.index({ 'reportante.id': 1 });
incSchema.index({ fechaResolucion: 1 }, { expireAfterSeconds: 60 * 24 * 3600 });

const Inc = model('Incidencia', incSchema);

// Configuración de Supabase con fallback seguro
const sb = (process.env.SUPABASE_URL && process.env.SUPABASE_URL.startsWith('http')) 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY) 
    : { 
        storage: { 
            from: () => ({ 
                upload: async () => ({ error: null }), 
                createSignedUrl: async () => ({ data: { signedUrl: 'http://localhost/mock' } }) 
            }) 
        } 
    };

const BUCKET = process.env.SUPABASE_BUCKET || 'evidencias';

const up = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 15e6, files: 5 }, 
    fileFilter: (r, f, cb) => cb(null, ['image/jpeg', 'image/png', 'application/pdf'].includes(f.mimetype)) 
});

const app = express();
app.use(cors(), express.json());

const h = (f) => (q, s, n) => f(q, s, n).catch(n);

const auth = (...roles) => (req, res, next) => {
    try {
        req.user = jwt.verify((req.headers.authorization || '').slice(7), process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Sesión inválida' });
    }
    if (roles.length && !roles.includes(req.user.rol)) {
        return res.status(403).json({ error: 'No tienes permisos' });
    }
    next();
};

const token = u => jwt.sign({ id: u._id, nombre: u.nombre, email: u.email, rol: u.rol }, process.env.JWT_SECRET, { expiresIn: '8h' });
const pub = u => ({ id: u._id, nombre: u.nombre, email: u.email, rol: u.rol });

// ---- AUTH ----
app.post('/api/auth/register', h(async (q, s) => {
    const { nombre, email, password } = q.body;
    if (!nombre || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 8) {
        return s.status(400).json({ error: 'Nombre, correo válido y contraseña de 8+ caracteres' });
    }
    if (await User.findOne({ email })) {
        return s.status(409).json({ error: 'El correo ya está registrado' });
    }
    const u = await User.create({ nombre, email, password: await bcrypt.hash(password, 10), rol: 'usuario' });
    s.status(201).json({ token: token(u), user: pub(u) });
}));

app.post('/api/auth/login', h(async (q, s) => {
    const u = await User.findOne({ email: (q.body.email || '').toLowerCase() });
    if (!u || !await bcrypt.compare(q.body.password || '', u.password)) {
        return s.status(401).json({ error: 'Credenciales incorrectas' });
    }
    s.json({ token: token(u), user: pub(u) });
}));

app.post('/api/users', auth('admin'), h(async (q, s) => {
    const { nombre, email, password, rol } = q.body;
    if (!['tecnico', 'admin', 'usuario'].includes(rol) || !nombre || !email || (password || '').length < 8) {
        return s.status(400).json({ error: 'Datos inválidos' });
    }
    const u = await User.create({ nombre, email, password: await bcrypt.hash(password, 10), rol });
    s.status(201).json(pub(u));
}));

app.get('/api/tecnicos', auth('admin', 'tecnico'), h(async (q, s) => {
    const tecnicos = await User.find({ rol: 'tecnico' });
    s.json(tecnicos.map(pub));
}));

// ---- Incidencias ----
app.get('/api/incidencias', auth(), h(async (q, s) => {
    const { q: txt, estado, categoria, prioridad, edificio, etiqueta, page = 1 } = q.query;
    const f = {};
    if (q.user.rol === 'usuario') f['reportante.id'] = new mongoose.Types.ObjectId(q.user.id);
    if (txt) f.$text = { $search: txt };
    if (estado) f.estado = estado;
    if (categoria) f.categoria = categoria;
    if (prioridad) f.prioridad = prioridad;
    if (edificio) f.edificio = edificio;
    if (etiqueta) f.etiquetas = etiqueta.replace('#', '');

    const L = 10;
    const [items, total] = await Promise.all([
        Inc.find(f).select('-historial').sort({ createdAt: -1 }).skip((page - 1) * L).limit(L),
        Inc.countDocuments(f)
    ]);
    s.json({ items, total, pages: Math.ceil(total / L) });
}));

app.post('/api/incidencias', auth(), up.array('evidencias', 5), h(async (q, s) => {
    const b = q.body;
    const tags = [...new Set(JSON.parse(b.etiquetas || '[]').map(t => String(t).replace('#', '').trim()).filter(Boolean))].slice(0, 10);
    if ((b.titulo || '').length < 5 || b.titulo.length > 80 || (b.descripcion || '').length < 10 || !CATS.includes(b.categoria) || !PRIOS.includes(b.prioridad) || !b.edificio) {
        return s.status(400).json({ error: 'Revisa título (5-80), descripción (10+), categoría, prioridad y edificio' });
    }
    const c = await Counter.findOneAndUpdate({ _id: 'folio' }, { $inc: { n: 1 } }, { upsert: true, new: true });
    const folio = `UTM-${new Date().getFullYear()}-${String(c.n).padStart(4, '0')}`;
    
    const evidencias = [];
    for (const f of q.files || []) {
        const path = `${folio}/${Date.now()}-${f.originalname.replace(/[^\w.-]/g, '_')}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, f.buffer, { contentType: f.mimetype });
        if (error) return s.status(502).json({ error: 'Falló la subida de archivos' });
        evidencias.push({ path, nombre: f.originalname, tipo: f.mimetype, size: f.size });
    }

    const d = await Inc.create({
        folio,
        titulo: b.titulo,
        descripcion: b.descripcion,
        categoria: b.categoria,
        prioridad: b.prioridad,
        edificio: b.edificio,
        espacio: b.espacio,
        etiquetas: tags,
        datosCategoria: b.datosCategoria ? JSON.parse(b.datosCategoria) : {},
        evidencias,
        reportante: { id: q.user.id, nombre: q.user.nombre, email: q.user.email },
        historial: [{ tipo: 'creacion', autor: q.user.nombre, comentario: 'Incidencia creada', estadoNuevo: 'Abierta' }]
    });
    s.status(201).json(d);
}));

app.get('/api/incidencias/export', auth('tecnico', 'admin'), h(async (q, s) => {
    s.json(await Inc.find().lean());
}));

app.get('/api/incidencias/:id', auth(), h(async (q, s) => {
    const d = await Inc.findById(q.params.id);
    if (!d) return s.status(404).json({ error: 'No encontrada' });
    if (q.user.rol === 'usuario' && String(d.reportante.id) !== q.user.id) {
        return s.status(403).json({ error: 'No tienes permisos' });
    }
    const o = d.toObject();
    o.evidencias = await Promise.all(o.evidencias.map(async e => ({
        ...e,
        url: (await sb.storage.from(BUCKET).createSignedUrl(e.path, 3600)).data?.signedUrl
    })));
    s.json(o)
}));

app.patch('/api/incidencias/:id/estado', auth('tecnico', 'admin'), h(async (q, s) => {
    const { estado, comentario } = q.body;
    if (!ESTADOS.includes(estado)) return s.status(400).json({ error: 'Estado inválido' });
    if (estado === 'Cerrada' && q.user.rol !== 'admin') return s.status(403).json({ error: 'Solo el administrador cierra incidencias' });
    
    const d = await Inc.findById(q.params.id);
    if (!d) return s.status(404).json({ error: 'No encontrada' });
    
    d.historial.push({ tipo: 'estado', autor: q.user.nombre, comentario, estadoAnterior: d.estado, estadoNuevo: estado });
    d.estado = estado;
    if (['Resuelta', 'Cerrada'].includes(estado)) {
        d.fechaResolucion ??= new Date();
    } else {
        d.fechaResolucion = undefined;
    }
    await d.save();
    s.json(d);
}));

app.post('/api/incidencias/:id/intervenciones', auth('tecnico', 'admin'), h(async (q, s) => {
    const { comentario, horas } = q.body;
    if (!comentario || !(horas >= 0)) return s.status(400).json({ error: 'Comentario y horas son obligatorios' });
    const d = await Inc.findByIdAndUpdate(
        q.params.id, 
        { $push: { historial: { tipo: 'intervencion', autor: q.user.nombre, comentario, horas: +horas } } }, 
        { new: true }
    );
    s.json(d);
}));

app.patch('/api/incidencias/:id/asignar', auth('admin'), h(async (q, s) => {
    const t = await User.findOne({ _id: q.body.tecnicoId, rol: 'tecnico' });
    if (!t) return s.status(400).json({ error: 'Técnico inválido' });
    const d = await Inc.findByIdAndUpdate(
        q.params.id, 
        { tecnico: { id: t._id, nombre: t.nombre }, $push: { historial: { tipo: 'asignacion', autor: q.user.nombre, comentario: `Asignada a ${t.nombre}` } } }, 
        { new: true }
    );
    s.json(d);
}));

// ---- Exportación a Excel ----
app.get('/api/export/excel', auth('tecnico', 'admin'), h(async (q, s) => {
    const { q: txt, estado, categoria, prioridad, edificio, etiqueta, desde, hasta } = q.query;
    const f = {};
    if (txt) f.$text = { $search: txt };
    if (estado) f.estado = estado;
    if (categoria) f.categoria = categoria;
    if (prioridad) f.prioridad = prioridad;
    if (edificio) f.edificio = edificio;
    if (etiqueta) f.etiquetas = etiqueta.replace('#', '');
    if (desde || hasta) {
        f.createdAt = {};
        if (desde) f.createdAt.$gte = new Date(desde);
        if (hasta) f.createdAt.$lte = new Date(hasta + 'T23:59:59.999');
    }
    const L = await Inc.find(f).sort({ createdAt: -1 }).limit(20000).lean();
    const wb = buildWorkbook(L, { ESTADOS, CATS, PRIOS }, Object.entries(q.query).map(([k, v]) => `${k}=${v}`).join(', '));
    s.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    s.setHeader('Content-Disposition', 'attachment; filename="utm-desk-control.xlsx"');
    await wb.xlsx.write(s);
    s.end();
}));

// ---- Base de conocimiento ----
app.get('/api/kb', auth(), h(async (q, s) => {
    const r = new RegExp((q.query.q || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    s.json(await Art.find({ $or: [{ titulo: r }, { contenido: r }] }).sort({ createdAt: -1 }));
}));

app.post('/api/kb', auth('tecnico', 'admin'), h(async (q, s) => {
    const { titulo, contenido } = q.body;
    if ((titulo || '').length < 5 || (contenido || '').length < 10) return s.status(400).json({ error: 'Título (5+) y contenido (10+) obligatorios' });
    s.status(201).json(await Art.create({ titulo, contenido, autor: q.user.nombre }));
}));

app.delete('/api/kb/:id', auth('tecnico', 'admin'), h(async (q, s) => {
    await Art.findByIdAndDelete(q.params.id);
    s.json({ ok: true });
}));

// ---- Estadísticas ----
app.get('/api/stats', auth('tecnico', 'admin'), h(async (q, s) => {
    const [porEstado, tiempoPorEdificio, topEtiquetas, porCategoria, porPrioridad, carga] = await Promise.all([
        Inc.aggregate([{ $group: { _id: '$estado', n: { $sum: 1 } } }]),
        Inc.aggregate([
            { $match: { fechaResolucion: { $type: 'date' } } },
            { $group: { _id: '$edificio', horasPromedio: { $avg: { $divide: [{ $subtract: ['$fechaResolucion', '$createdAt'] }, 36e5] } }, n: { $sum: 1 } } },
            { $sort: { horasPromedio: 1 } }
        ]),
        Inc.aggregate([{ $unwind: '$etiquetas' }, { $group: { _id: '$etiquetas', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]),
        Inc.aggregate([{ $group: { _id: '$categoria', n: { $sum: 1 } } }]),
        Inc.aggregate([{ $group: { _id: '$prioridad', n: { $sum: 1 } } }]),
        Inc.aggregate([{ $match: { estado: { $nin: ['Resuelta', 'Cerrada'] } } }, { $group: { _id: '$edificio', n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    ]);
    s.json({ porEstado, tiempoPorEdificio, topEtiquetas, porCategoria, porPrioridad, carga });
}));

app.use((e, q, s, n) => {
    console.error(e);
    s.status(500).json({ error: 'Error interno del servidor' });
});

async function start() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        await Inc.syncIndexes();
        console.log('✅ Conectado a MongoDB Atlas');

        if (process.env.ADMIN_EMAIL && !await User.findOne({ rol: 'admin' })) {
            await User.create({ 
                nombre: 'Administrador', 
                email: process.env.ADMIN_EMAIL, 
                password: await bcrypt.hash(process.env.ADMIN_PASSWORD, 10), 
                rol: 'admin' 
            });
            console.log('🔑 Admin creado automáticamente');
        }

        if (!await Art.countDocuments()) {
            await Art.insertMany([
                { titulo: 'No tengo conexión a la red UTM-WiFi', contenido: '1. Olvida la red y vuelve a conectarte.\n2. Verifica que tu cuenta institucional esté activa.', autor: 'Sistema' },
                { titulo: 'El proyector del aula no enciende', contenido: 'Revisa el cable de corriente y HDMI...', autor: 'Sistema' },
                { titulo: 'No puedo entrar al portal académico (SISE)', contenido: 'Restablece tu contraseña desde el portal...', autor: 'Sistema' },
                { titulo: '¿Cuánto tarda la atención de mi reporte?', contenido: 'Según prioridad (SLA): Baja 48h, Media 24h, Alta 8h, Urgente menos de 2h.', autor: 'Sistema' }
            ]);
            console.log('📚 Artículos base creados');
        }

        app.listen(process.env.PORT || 4000, () => console.log('API lista'));
    } catch (err) {
        console.error('❌ Error al iniciar:', err);
        process.exit(1);
    }
}

start();
