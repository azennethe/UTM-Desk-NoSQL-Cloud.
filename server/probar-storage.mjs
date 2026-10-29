// Verificación real de Storage: sube, firma, lee y borra un archivo de prueba en cada bucket.
// Usa el mismo cliente y el mismo clasificador que la API (clienteSupabase + validarArchivo),
// así que lo que falla aquí es exactamente lo que fallaría al usuario en la web.
// No necesita MongoDB: solo credenciales de server/.env.
//   node probar-storage.mjs
import 'dotenv/config';
import { clienteSupabase, motivoStorage } from './index.js';
import { validarArchivo, rutaDe, nombreBucket } from './archivos.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'latin1');

const CASOS = [
    { operacion: 'incidencia', nombre: 'evidencia-prueba.png', buffer: png, carpeta: 'incidencias/verificacion' },
    { operacion: 'incidencia', nombre: 'documento-prueba.pdf', buffer: pdf, carpeta: 'incidencias/verificacion' },
    { operacion: 'perfil', nombre: 'perfil-prueba.png', buffer: png, carpeta: 'usuarios/verificacion' },
];

const sb = clienteSupabase();
if (!sb) {
    console.error('FALTA CONFIGURACION: server/.env necesita SUPABASE_URL (https://…) y SUPABASE_SECRET_KEY/SUPABASE_SERVICE_KEY.');
    process.exit(1);
}

const { data: buckets, error: eBuckets } = await sb.storage.listBuckets();
if (eBuckets) console.log('· listBuckets ->', motivoStorage(eBuckets));
else console.log('· buckets visibles para esta clave:', (buckets || []).map(b => b.name).join(', ') || '(ninguno: las claves publishable/anon no ven los buckets por RLS)');

// Para distinguir «el bucket no existe» de «existe pero tu clave no puede escribir», se intenta
// el mismo upload contra un nombre inventado: ese error sí es de bucket inexistente.
const prueba = await sb.storage.from('no-existe-este-bucket-de-prueba').upload('x/y.png', png, { contentType: 'image/png', upsert: false });
console.log('· control (bucket inventado):', motivoStorage(prueba.error || {}));

let ok = 0, mal = 0;
for (const c of CASOS) {
    const etiqueta = `${c.nombre} (${c.operacion})`;
    let info;
    try { info = validarArchivo({ originalname: c.nombre, buffer: c.buffer }, c.operacion); }
    catch (e) { console.log(`X clasificacion ${etiqueta}: ${e.message}`); mal++; continue; }
    const bucket = info.bucket;
    const { ruta } = rutaDe(c.carpeta, c.nombre);
    const linea = [];
    let fallo = false;

    const up = await sb.storage.from(bucket).upload(ruta, c.buffer, { contentType: info.tipo, upsert: false });
    if (up.error) { console.log(`X SUBIDA ${etiqueta} -> ${bucket}: ${motivoStorage(up.error)}`); mal++; continue; }
    linea.push('subida 201-equivalente ok');

    const firmado = await sb.storage.from(bucket).createSignedUrl(ruta, 60);
    if (firmado.error) { console.log(`X FIRMA ${etiqueta} -> ${bucket}: ${firmado.error.message}`); linea.length && await sb.storage.from(bucket).remove([ruta]); mal++; continue; }
    const lectura = await fetch(firmado.data.signedUrl);
    linea.push(`URL firmada HTTP ${lectura.status} (${await lectura.arrayBuffer().then(b => b.byteLength)} bytes)`);

    const borrado = await sb.storage.from(bucket).remove([ruta]);
    linea.push(borrado.error ? `AVISO: no se pudo borrar el archivo de prueba (${borrado.error.message})` : 'archivo de prueba borrado');
    if (borrado.error) fallo = true;

    console.log(`OK ${etiqueta} -> ${bucket} · ${linea.join(' · ')}`);
    ok++;
    if (fallo) mal++;
}

console.log(`\nRESUMEN: ${ok} de ${CASOS.length} operaciones de archivo funcionaron contra el proyecto real.` +
    `\nBuckets declarados: ${Object.keys(nombreBucket ? { evidencias: nombreBucket('evidencias'), documentos: nombreBucket('documentos'), perfiles: nombreBucket('perfiles') } : {})}`);
process.exit(mal ? 1 : 0);
