// Datos de demostración exigidos por la consigna:
//   20-30 incidencias, >=15 con evidencias, >=8 con fecha de resolución, >=4 edificios.
// Escritura protegida: sin --yes solo muestra lo que haría, y nunca toca documentos
// que no estén marcados con origen:'demo'.
//   node seed-demo.js --yes            (usa MONGODB_URI del .env)
//   node seed-demo.js --yes --limpiar  (elimita solo los documentos demo creados aquí)
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Inc, User, CATS, PRIOS, CAMPOS_CATEGORIA, clienteSupabase, siguienteFolio, limpiarEtiquetas } from './index.js';
import { nombreBucket, rutaDe, resumenBuckets } from './archivos.js';
const ES_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const PASS = process.env.DEMO_PASSWORD || 'Demo.2026';

// PNG de 1x1 px real y PDF mínimo válido: son archivos de prueba legítimos,
// no metadatos inventados sin archivo detrás.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);
const PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF',
    'latin1'
);

// Mismas zonas que ofrece el formulario del cliente (client/src/App.tsx, EDIF)
const EDIF = ['Edificio A', 'Edificio B', 'Edificio C', 'Edificio D', 'Biblioteca', 'Rectoría'];
const ESPACIO = ['Aula 12', 'Aula 3', 'Lab. 2', 'Sala 4', 'Módulo B', 'Vestíbulo', 'Office 101', 'Cubículo 7'];
const TAGS = ['wifi', 'switch', 'poE', 'proyector', 'falta-de-luz', 'climatizacion', 'sisep', 'moodle', 'vpn', 'impresora', 'cableado', 'nutria'];

const REPORTES = [
    ['No hay red inalámbrica en el aula', 'Los equipos del aula pierden conexión UTM-WiFi cada pocos minutos y el punto de acceso queda sin clientes asociados.'],
    ['El proyector no detecta la señal HDMI', 'Al conectar el portátil el proyector muestra "sin señal"; con otro cable funciona, así que sospechamos del puerto HDMI.'],
    ['Switch del laboratorio sin enlaces activos', 'Los cuatro puertos del switch del Lab. 2 quedan sin LED de enlace y las PCs muestran red no identificada.'],
    ['Fuga de agua cerca del rack', 'Se filtra agua por el techo sobre el gabinete de comunicaciones; hay riesgo de contacto con equipos energizados.'],
    ['Aire acondicionado no enfría el aula magna', 'El equipo enciende pero sopla aire templado; la temperatura del aula supera los 30 grados en horario matutino.'],
    ['Luminarias del pasillo sin operar', 'Tres luminarias del pasillo de segundo piso quedaron apagadas y el área queda con iluminación insuficiente.'],
    ['No puedo entrar al portal académico', 'El SISE rechaza mi contraseña institucional aun después de restablecerla desde el portal de autoservicio.'],
    ['Moodle muy lento al abrir cursos', 'Los estudiantes reportan tiempos de carga de más de dos minutos en las tareas de Moodle durante la mañana.'],
    ['La impresora del edificio no responde', 'La cola de impresión queda detenida y el equipo muestra error de cartucho aunque se reemplazó.'],
    ['VLAN incorrecta en el puerto del laboratorio', 'Al cambiar de equipo los hosts reciben una dirección de otro rango y no alcanzan el servidor de prácticas.'],
    ['VPN institucional no autentica', 'El cliente VPN devuelve error de túnel al intentar conectar desde la red externa del campus.'],
    ['Cable de red dañado en el aula', 'El punto de red del docente está partido en la base y pierde conexión cuando se mueve el equipo.'],
];

const dias = n => new Date(Date.now() - n * 864e5);

const aleat = (semilla) => {
    let x = semilla;
    return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
};

const rnd = aleat(20261023);
const pick = a => a[Math.floor(rnd() * a.length)];

// Mismo criterio que la API: la imagen va a incidencias-evidencias y el PDF a
// incidencias-documentos; cada documento guarda el bucket de su archivo.
async function subir(sb, folio, i) {
    const png = i % 3 !== 2;
    const nombre = (png ? 'evidencia-' : 'reporte-') + folio + '-' + (i + 1) + (png ? '.png' : '.pdf');
    const { ruta } = rutaDe(`demo/${folio}`, nombre);
    const bucket = nombreBucket(png ? 'evidencias' : 'documentos');
    const buffer = png ? PNG : PDF;
    const { error } = await sb.storage.from(bucket).upload(ruta, buffer, {
        contentType: png ? 'image/png' : 'application/pdf',
        upsert: false,
    });
    if (error) throw new Error('Supabase rechazó la subida: ' + error.message);
    return { path: ruta, bucket, nombre, tipo: png ? 'image/png' : 'application/pdf', size: buffer.length, subidoPor: 'seed-demo', fecha: new Date() };
}

async function upsertUsuario({ nombre, email, rol }) {
    const existente = await User.findOne({ email });
    if (existente) return existente;
    return User.create({ nombre, email, password: await bcrypt.hash(PASS, 10), rol });
}

function datosDe(cat, i) {
    const cfg = CAMPOS_CATEGORIA[cat];
    const base = {
        [CATS[0]]: {
            tipo_equipo: pick(['Laptop docente', 'Switch PoE', 'Punto de acceso', 'Proyector', 'PC de laboratorio']),
            equipos_afectados: String(1 + (i % 8)),
            ...(i % 2 ? { direccion_ip: `162.128.${10 + (i % 40)}.${20 + i}` } : {}),
            ...(i % 3 ? { vlan: String(20 + (i % 900)) } : {}),
        },
        [CATS[1]]: {
            tipo_infraestructura: pick(['Climatización', 'Instalación eléctrica', 'Cableado estructurado', 'Hidráulica', 'Mobiliario']),
            area_afectada: pick(['Piso 1', 'Piso 2', 'Patio central', 'Acceso norte', 'Módulo de servicios']),
            riesgo_estructural: i % 4 === 0 ? 'Sí' : 'No',
            requiere_tercero: i % 3 === 0 ? 'Sí' : 'No',
        },
        [CATS[2]]: {
            sistema_afectado: pick(['SISE', 'Moodle', 'Correo institucional', 'Portal de calificaciones', 'VPN']),
            tipo_falla: pick(['Autenticación', 'Lentitud', 'Caída total', 'Error al guardar', 'Certificado']),
            usuarios_afectados: String(5 + i * 7),
            modulo: pick(['Inscripciones', 'Pagos', 'Cursos', 'Reportes', 'Acceso remoto']),
        },
    };
    const lim = {};
    for (const k of [...cfg.req, ...cfg.opt]) if (base[cat][k] !== undefined) lim[k] = base[cat][k];
    return lim;
}

export async function seed({
    aplicar = false,
    limpiar = false,
    uri = process.env.MONGODB_URI,
    storage = null,
    nombreStorage = 'Supabase',
    desconectar = true,
} = {}) {
    const sb = storage || clienteSupabase();
    if (!uri) throw new Error('Falta MONGODB_URI en el entorno');
    if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
    const cerrar = async () => { if (desconectar) await mongoose.disconnect(); };
    const db = mongoose.connection.name;
    console.log(`Base de datos destino: ${db}`);
    console.log(`Storage de archivos: ${sb ? nombreStorage : 'SIN CONFIGURAR → no se subirá evidencia'} · ${resumenBuckets()}`);

    const yaExistentes = await Inc.countDocuments({ origen: 'demo' });
    console.log(`Incidencias con origen "demo" ya presentes: ${yaExistentes}`);

    if (limpiar) {
        if (!aplicar) throw new Error('limpiar requiere aplicar:true: es una eliminación');
        const b = await Inc.deleteMany({ origen: 'demo' });
        console.log(`Eliminadas ${b.deletedCount} incidencias de demostración (solo origen "demo").`);
        await cerrar();
        return { total: 0 };
    }

    if (yaExistentes && !aplicar) {
        console.log('El seed ya fue aplicado. Ejecuta con --yes para re-sembrar borrando solo los datos demo.');
        await cerrar();
        return { total: yaExistentes };
    }

    if (!aplicar) {
        console.log('\nSIMULACIÓN: no se escribió nada. Reejecuta con --yes para aplicar.');
        await cerrar();
        return { total: yaExistentes, simulacion: true };
    }

    if (yaExistentes) {
        const b = await Inc.deleteMany({ origen: 'demo' });
        console.log(`Se retiraron ${b.deletedCount} incidencias demo anteriores antes de re-crearlas.`);
    }

    const reportantes = [];
    for (let i = 0; i < 6; i++) {
        reportantes.push(await upsertUsuario({
            nombre: ['Ana Cruz', 'Luis Peña', 'María Ortega', 'Jorge Ramírez', 'Sofía Luna', 'Pedro Nava'][i],
            email: `reportante${i + 1}@demo.utm.edu.mx`,
            rol: 'reportante',
        }));
    }
    const tecnicos = [];
    for (let i = 0; i < 3; i++) {
        tecnicos.push(await upsertUsuario({
            nombre: ['Téc. One', 'Téc. Two', 'Téc. Three'][i],
            email: `tecnico${i + 1}@demo.utm.edu.mx`,
            rol: 'tecnico',
        }));
    }
    await upsertUsuario({ nombre: 'Dirección de Servicios', email: 'directivo@demo.utm.edu.mx', rol: 'directivo' });
    console.log(`Usuarios de prueba listos: ${reportantes.length} reportantes, ${tecnicos.length} técnicos, 1 directivo.`);
    console.log(`(contraseña compartida de cuentas demo: ${process.env.DEMO_PASSWORD ? 'la de DEMO_PASSWORD' : 'Demo.2026, cambiar tras la demostración'})`);

    // Reparto fijo: 6 abiertas, 5 en proceso, 3 en espera, 6 resueltas, 4 cerradas = 24
    const PLAN = [
        ...Array(6).fill('Abierta'),
        ...Array(5).fill('En proceso'),
        ...Array(3).fill('En espera'),
        ...Array(6).fill('Resuelta'),
        ...Array(4).fill('Cerrada'),
    ];

    let conEvidencias = 0, subidas = 0, falladas = 0;

    for (let i = 0; i < PLAN.length; i++) {
        const estado = PLAN[i];
        const categoria = CATS[i % 3];
        const rep = reportantes[i % reportantes.length];
        const [titulo, descripcion] = REPORTES[i % REPORTES.length];
        const creado = dias(50 - i);
        const prior = PRIOS[i % 4];

        const folio = await siguienteFolio(creado);

        const evidencias = [];
        if (sb && i < 18) {
            for (let k = 0; k < (i % 2 ? 2 : 1); k++) {
                try {
                    evidencias.push(await subir(sb, folio, k));
                    subidas++;
                } catch (err) {
                    falladas++;
                    console.warn(`  aviso: ${folio} → ${err.message}`);
                }
            }
        }
        if (evidencias.length) conEvidencias++;

        const tec = estado === 'Abierta' ? null : tecnicos[i % tecnicos.length];
        const aprobada = estado !== 'Abierta' || i % 3 === 0;
        let fechaResolucion;
        if (['Resuelta', 'Cerrada'].includes(estado)) {
            // Dentro de los 45 días para que el índice TTL de 60 días no las borre
            fechaResolucion = new Date(creado.getTime() + (2 + (i % 20)) * 36e5);
        }

        const historial = [
            { tipo: 'creacion', autor: rep.nombre, rol: 'reportante', comentario: 'Incidencia creada', estadoNuevo: 'Abierta', fecha: creado },
        ];
        if (aprobada) historial.push({ tipo: 'autorizacion', autor: 'Sistema de demostración', rol: 'soporte_ti', comentario: 'Solicitud aprobada', fecha: new Date(creado.getTime() + 36e5) });
        if (tec) historial.push({ tipo: 'asignacion', autor: 'Sistema de demostración', rol: 'soporte_ti', comentario: `Asignada a ${tec.nombre}`, fecha: new Date(creado.getTime() + 54e5) });
        if (['En proceso', 'En espera', 'Resuelta', 'Cerrada'].includes(estado)) {
            historial.push({ tipo: 'estado', autor: tec?.nombre, rol: 'tecnico', comentario: 'Diagnóstico en sitio', estadoAnterior: 'Abierta', estadoNuevo: 'En proceso', fecha: new Date(creado.getTime() + 72e5) });
            historial.push({ tipo: 'intervencion', autor: tec?.nombre, rol: 'tecnico', comentario: pick(['Reemplazo de componente', 'Reconfiguración del servicio', 'Ajuste de cableado', 'Limpieza y revisión']), horas: 1 + (i % 4), fecha: new Date(creado.getTime() + 90e5) });
        }
        if (estado === 'En espera') historial.push({ tipo: 'estado', autor: tec?.nombre, rol: 'tecnico', comentario: 'Se espera refacción del proveedor', estadoAnterior: 'En proceso', estadoNuevo: 'En espera', fecha: new Date(creado.getTime() + 120e5) });
        if (fechaResolucion) historial.push({ tipo: 'estado', autor: tec?.nombre, rol: 'tecnico', comentario: 'Servicio restablecido y verificado', estadoAnterior: 'En proceso', estadoNuevo: 'Resuelta', fecha: fechaResolucion });
        if (estado === 'Cerrada') historial.push({ tipo: 'estado', autor: 'Sistema de demostración', rol: 'soporte_ti', comentario: 'Cierre tras validación del usuario', estadoAnterior: 'Resuelta', estadoNuevo: 'Cerrada', fecha: new Date(fechaResolucion.getTime() + 6 * 36e5) });

        const horasTotales = historial.reduce((a, x) => a + (x.horas || 0), 0);

        await Inc.create({
            folio, titulo: `${titulo} (${folio.slice(-4)})`.slice(0, 80), descripcion,
            categoria, prioridad: prior, estado,
            autorizacion: {
                estado: aprobada ? 'aprobada' : 'pendiente',
                por: aprobada ? { nombre: 'Sistema de demostración' } : undefined,
                fecha: aprobada ? new Date(creado.getTime() + 36e5) : undefined,
            },
            edificio: EDIF[i % EDIF.length], espacio: ESPACIO[i % ESPACIO.length],
            etiquetas: limpiarEtiquetas([TAGS[i % TAGS.length], TAGS[(i + 5) % TAGS.length]]),
            datosCategoria: datosDe(categoria, i),
            reportante: { id: rep._id, nombre: rep.nombre, email: rep.email },
            tecnico: tec ? { id: tec._id, nombre: tec.nombre } : undefined,
            evidencias, historial, horasTotales, fechaResolucion, origen: 'demo',
        });

        await Inc.collection.updateOne({ folio }, { $set: { createdAt: creado, updatedAt: new Date(fechaResolucion || historial.at(-1).fecha) } });
    }

    await Inc.syncIndexes();

    const edificios = await Inc.distinct('edificio', { origen: 'demo' });
    const total = await Inc.countDocuments({ origen: 'demo' });
    const conEv = await Inc.countDocuments({ origen: 'demo', 'evidencias.0': { $exists: true } });
    const conRes = await Inc.countDocuments({ origen: 'demo', fechaResolucion: { $type: 'date' } });

    const cumplimiento = [
        ['20-30 incidencias de prueba', total, total >= 20 && total <= 30],
        ['Al menos 15 con evidencias', conEv, conEv >= 15],
        ['Al menos 8 con fecha de resolución', conRes, conRes >= 8],
        ['Al menos 4 edificios o zonas', edificios.length, edificios.length >= 4],
    ];

    console.log('\nVerificación final:');
    for (const [c, v, ok] of cumplimiento) console.log(`  ${ok ? '✔' : '✘'} ${c}: ${v}`);
    console.log(`\nArchivos de evidencia subidos a ${nombreStorage}: ${subidas || 0}${subidas ? '' : ' — sin storage configurado'}`);
    if (falladas) console.log(`Subidas fallidas: ${falladas}`);
    if (!sb) console.log('PENDIENTE: sin SUPABASE_URL + SUPABASE_SECRET_KEY las incidencias quedaron SIN evidencias reales. Configura los buckets privados y reejecuta el seed.');

    const verificado = cumplimiento.every(x => x[2]);
    if (!verificado) console.error('\nEl seed NO cumple todas las condiciones; revisa los avisos anteriores.');

    await cerrar();
    return { total, conEv, conRes, edificios: edificios.length, subidas, verificado };
}

if (ES_CLI) {
    seed({
        aplicar: process.argv.includes('--yes'),
        limpiar: process.argv.includes('--limpiar'),
    }).catch(async (err) => {
        console.error('Error:', err.message);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}
