const B=import.meta.env.VITE_API_URL||'http://localhost:4000/api';
export async function api(p:string,o:any={}){const t=localStorage.getItem('t'),f=o.body instanceof FormData,get=!o.method||o.method==='GET';
 try{const r=await fetch(B+p,{...o,headers:{...(f?{}:{'Content-Type':'application/json'}),...(t?{Authorization:'Bearer '+t}:{})},body:f||!o.body?o.body:JSON.stringify(o.body)});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Error de red');
  if(get)try{localStorage.setItem('c:'+p,JSON.stringify(d))}catch{}return d}
 catch(x:any){if(get&&x instanceof TypeError){const c=localStorage.getItem('c:'+p);if(c)return JSON.parse(c)}throw x}}

export async function excel(p:any){const q=new URLSearchParams(Object.entries(p).filter(([,v])=>v) as any),t=localStorage.getItem('t');
 const r=await fetch(B+'/export/excel?'+q,{headers:{Authorization:'Bearer '+t}});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'No se pudo generar el Excel');
 const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download=`UTM-Desk-control-${new Date().toISOString().slice(0,10)}.xlsx`;a.click();URL.revokeObjectURL(a.href)}
