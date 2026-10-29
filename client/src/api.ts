// Limpieza inmediata de datos cacheados en localStorage para garantizar
// que NUNCA se muestren datos que no provengan en tiempo real de MongoDB Atlas.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('c:')) localStorage.removeItem(k);
  }
} catch {}

// En desarrollo la API vive en otro puerto; en producción el bundle puede servirlo la misma
// API (`server/index.js` publica client/dist), y entonces `/api` basta: no hay que fijar
// VITE_API_URL ni declarar el origen en CLIENT_URL para que el navegador lo acepte.
// Un `VITE_API_URL=http://localhost:4000/api` en client/.env es correcto para `npm run dev`,
// pero Vite lo lee también al compilar: si llega al bundle público, la web queda apuntando a
// la laptop de quien hizo el build. En producción se ignora cualquier localhost y solo se
// acepta una URL absoluta (API en otro host), si no el propio origen.
const ENV = String(import.meta.env.VITE_API_URL || '');
const B = import.meta.env.DEV
    ? ENV || 'http://localhost:4000/api'
    : ENV && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(ENV) ? ENV : '/api';
// Un TypeError de fetch significa que la API no contestó (puerto apagado u origen
// rechazado por CORS); "Failed to fetch" solo no le dice nada al usuario.
const sinApi = () =>
    new Error(B.startsWith('http')
        ? `No se pudo conectar con el servidor en ${B}. Verifica que el backend esté ejecutándose con «npm run dev» en la carpeta server/ y conectado a MongoDB Atlas.`
        : 'El servidor no respondió. La aplicación se sirve desde él, así que revisa que el proceso siga en línea.');

export async function api(p: string, o: any = {}) {
  const t = localStorage.getItem('t'),
    f = o.body instanceof FormData;
  try {
    const r = await fetch(B + p, {
      ...o,
      headers: {
        ...(f ? {} : { 'Content-Type': 'application/json' }),
        ...(t ? { Authorization: 'Bearer ' + t } : {}),
      },
      body: f || !o.body ? o.body : JSON.stringify(o.body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Error de red');
    // Se elimina el guardado en caché local: solo se devuelven datos reales de MongoDB Atlas
    return d;
  } catch (x: any) {
    if (x instanceof TypeError) {
      // Sin fallback a localStorage: si no hay conexión real a Atlas, se notifica el error
      throw sinApi();
    }
    throw x;
  }
}

// Estado del almacén real de la API conectada. Sin caché: si el puerto cambió o la API
// está apagada, la interfaz no puede seguir afirmando que escribe en MongoDB Atlas.
export async function estado():Promise<{almacen?:string;storage?:{hay:boolean;buckets:string[];motivo:string}}>{
 try{const r=await fetch(B+'/estado');return r.ok?await r.json():{}}catch{return {}}}

export async function excel(p:any){const q=new URLSearchParams(Object.entries(p).filter(([,v])=>v) as any),t=localStorage.getItem('t');
 let r:Response;try{r=await fetch(B+'/export/excel?'+q,{headers:{Authorization:'Bearer '+t}})}catch{throw sinApi()}
 if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'No se pudo generar el Excel');
 const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download=`UTM-Desk-control-${new Date().toISOString().slice(0,10)}.xlsx`;a.click();URL.revokeObjectURL(a.href)}
