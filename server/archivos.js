// Clasificación centralizada de archivos: decide el bucket la OPERACIÓN de la aplicación,
// nunca un parámetro del cliente ni únicamente la extensión declarada por el navegador.
//   operacion 'incidencia' → incidencias-evidencias (fotos/capturas) o incidencias-documentos (PDF, Word, Excel, TXT)
//   operacion 'perfil'     → usuarios-archivos (foto de perfil)
// Los nombres finales del bucket se leen del entorno para poder apuntar al bucket que ya
// existe en el proyecto Supabase sin crear uno nuevo.
import path from 'node:path';

export const MAX_POR_LOTE = 5;
// Tope físico de multer: el máximo de los tres buckets. El límite real por tipo se aplica
// después, en validarArchivo(), antes de llamar a Supabase.
export const MAX_FISICO = 20e6;

export const BUCKETS = {
    evidencias: { var: 'SUPABASE_BUCKET_EVIDENCIAS', heredable: 'SUPABASE_BUCKET', predeterminado: 'incidencias-evidencias', max: 10e6, etiqueta: 'evidencia' },
    documentos: { var: 'SUPABASE_BUCKET_DOCUMENTOS', predeterminado: 'incidencias-documentos', max: 20e6, etiqueta: 'documento' },
    perfiles: { var: 'SUPABASE_BUCKET_PERFILES', predeterminado: 'usuarios-archivos', max: 5e6, etiqueta: 'foto de perfil' },
};

export const nombreBucket = clave => {
    const c = BUCKETS[clave];
    const explicito = process.env[c.var];
    if (typeof explicito === 'string' && explicito.trim()) return explicito.trim();
    // 'evidencias' puede seguir escribiendo en el bucket histórico del proyecto
    if (c.heredable) {
        const legado = process.env[c.heredable];
        if (typeof legado === 'string' && legado.trim()) return legado.trim();
    }
    return c.predeterminado;
};

// tipo real → extensión admitida y si es imagen (define el bucket de una incidencia)
const TIPOS = {
    'image/jpeg': { ext: ['jpg', 'jpeg'], imagen: true },
    'image/png': { ext: ['png'], imagen: true },
    'image/webp': { ext: ['webp'], imagen: true },
    'application/pdf': { ext: ['pdf'], imagen: false },
    'application/msword': { ext: ['doc'], imagen: false },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: ['docx'], imagen: false },
    'application/vnd.ms-excel': { ext: ['xls'], imagen: false },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: ['xlsx'], imagen: false },
    'text/plain': { ext: ['txt'], imagen: false },
};

// No se admite GIF: la consigna lo permite solo si el flujo lo requiere y el flujo de
// evidencia opera con capturas estáticas (JPG/PNG/WebP).
const RECHAZADOS = {
    'image/gif': 'no se admiten GIF animados en este flujo',
    'application/zip': 'un ZIP genérico no es un documento admisible',
    'application/octet-stream': 'binario sin tipo reconocido',
};

const eq = (b, bytes, off = 0) => bytes.every((x, i) => b[off + i] === x);

// Lee los bytes reales: el MIME del navegador es una pista, nunca la autoridad.
export function tipoReal(buf) {
    if (!buf || buf.length < 4) return null;
    if (eq(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (eq(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
    if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
    if (eq(buf, [0x50, 0x4b, 0x03, 0x04])) {
        // DOCX y XLSX son ZIPs: se distinguen por la carpeta que declara su esquema
        const s = buf.subarray(0, Math.min(buf.length, 65536)).toString('latin1');
        if (s.includes('word/')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        if (s.includes('xl/')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        return 'application/zip';
    }
    if (eq(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
        // DOC y XLS legacy comparten firma OLE2; la extensión decide cuál de los dos
        return 'application/ole2';
    }
    if (buf.includes(0)) return 'application/octet-stream';
    return 'text/plain';
}

const extension = nombre => {
    const e = path.extname(String(nombre || '')).toLowerCase().replace(/^\./, '');
    return /^[a-z0-9]{1,8}$/.test(e) ? e : '';
};

// MIMEs que acepta cada operación: solo se usa en el fileFilter de multer, donde todavía
// no hay buffer. La validación fuerte es validarArchivo().
export const mimeAceptado = operacion => {
    if (operacion === 'perfil') return Object.entries(TIPOS).filter(([, v]) => v.imagen).map(([k]) => k);
    return Object.keys(TIPOS);
};

const error = (mensaje, status = 400) => { const e = new Error(mensaje); e.status = status; return e; };

/**
 * Clasifica y valida un archivo según la operación que lo origina.
 * @returns { bucket, clave, tipo, extension, max }
 */
export function validarArchivo({ originalname, mimetype, buffer }, operacion) {
    const e = extension(originalname);
    const real = tipoReal(buffer);
    const nombre = String(originalname || 'archivo').slice(0, 120);

    if (!buffer || !buffer.length) throw error(`El archivo «${nombre}» está vacío`);
    if (RECHAZADOS[real]) throw error(`«${nombre}» no es un archivo admisible: ${RECHAZADOS[real]}`);

    // Un .doc/.xls reales llegan como OLE2: la extensión legítima los identifica
    const viaOle = real === 'application/ole2' && ['doc', 'xls'].includes(e);
    const tipo = viaOle ? (e === 'doc' ? 'application/msword' : 'application/vnd.ms-excel') : real;
    const cfg = TIPOS[tipo];
    if (!cfg) throw error(`«${nombre}» no tiene un contenido reconocible (JPG, PNG, WebP, PDF, DOC, DOCX, XLS, XLSX o TXT)`);

    // La extensión, el contenido y el MIME declarado deben coincidir: un .jpg con bytes de
    // ejecutable se rechaza, igual que un PDF renombrado a .txt
    if (!e || !cfg.ext.includes(e)) {
        throw error(`«${nombre}» dice ser .${e || 'sin extensión'} pero su contenido es ${tipo}`);
    }
    if (typeof mimetype === 'string' && mimetype && mimetype !== 'application/octet-stream' && mimetype !== tipo) {
        throw error(`«${nombre}» envía el tipo ${mimetype} pero su contenido real es ${tipo}`);
    }

    if (operacion === 'perfil' && !cfg.imagen) throw error('La foto de perfil debe ser JPG, PNG o WebP');

    const clave = operacion === 'perfil' ? 'perfiles' : cfg.imagen ? 'evidencias' : 'documentos';
    const b = BUCKETS[clave];
    if (buffer.length > b.max) throw error(`Cada ${b.etiqueta} debe pesar menos de ${Math.round(b.max / 1e6)} MB («${nombre}» pesa ${(buffer.length / 1e6).toFixed(1)} MB)`, 413);

    return { clave, bucket: nombreBucket(clave), tipo, max: b.max };
}

// Ruta dentro del bucket: carpeta de la operación + marca de tiempo + token aleatorio +
// nombre saneado. path.basename elimina cualquier ../ inyectado en el nombre original.
export function rutaDe(carpeta, originalname) {
    // cada segmento de la carpeta se sanea por separado: permite rutas anidadas
    // (usuarios/<id>) sin aceptar ../ ni caracteres de control
    const dirs = String(carpeta || 'misc').split('/').map(p => p.replace(/[^\w.-]/g, '_').replace(/^\.+/, '')).filter(Boolean);
    const base = path.basename(String(originalname || 'archivo')).replace(/[^\w.()-]/g, '_').replace(/^\.+/, '') || 'archivo';
    const unico = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    return { ruta: [...dirs, `${unico}-${base}`].join('/').slice(0, 300), nombre: base };
}

export const resumenBuckets = () => Object.entries(BUCKETS)
    .map(([k, v]) => `${k} → ${nombreBucket(k)} (${Math.round(v.max / 1e6)} MB)`).join(' · ');
