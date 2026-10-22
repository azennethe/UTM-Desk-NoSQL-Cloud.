const S='drafts';let syncing=false;
const open=()=>new Promise<IDBDatabase>((res,rej)=>{const r=indexedDB.open('utmdesk',1);r.onupgradeneeded=()=>r.result.createObjectStore(S,{keyPath:'id',autoIncrement:true});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const tx=async<T>(m:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest<T>)=>{const db=await open();return new Promise<T>((res,rej)=>{const r=fn(db.transaction(S,m).objectStore(S));r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})};
export const toFD=(fields:any,files:File[])=>{const fd=new FormData();Object.entries(fields).forEach(([k,v])=>fd.append(k,v as string));files.forEach(x=>fd.append('evidencias',x));return fd};
export async function saveDraft(fields:any,files:File[]){await tx('readwrite',s=>s.add({fields,files,ts:Date.now()}));window.dispatchEvent(new Event('drafts-changed'))}
export const countDrafts=()=>tx<number>('readonly',s=>s.count());
export async function syncDrafts(api:any){if(syncing)return{ok:0,fail:0};syncing=true;let ok=0,fail=0;
 try{const all:any[]=await tx('readonly',s=>s.getAll());
  for(const d of all){try{await api('/incidencias',{method:'POST',body:toFD(d.fields,d.files)});await tx('readwrite',s=>s.delete(d.id));ok++}
   catch(x:any){if(x instanceof TypeError||x.message==='Sesión inválida')break;await tx('readwrite',s=>s.delete(d.id));fail++}}}
 finally{syncing=false}return{ok,fail}}
