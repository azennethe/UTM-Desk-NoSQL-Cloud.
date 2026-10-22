import ExcelJS from 'exceljs';
const G='FF065F46',fmt='dd/mm/yyyy hh:mm';
const head=(ws)=>{const r=ws.getRow(1);r.height=22;r.font={bold:true,color:{argb:'FFFFFFFF'}};r.fill={type:'pattern',pattern:'solid',fgColor:{argb:G}};r.alignment={vertical:'middle'};
 ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:{row:1,column:1},to:{row:1,column:ws.columns.length}}};
export function buildWorkbook(L,{ESTADOS,CATS,PRIOS},filtros=''){
 const wb=new ExcelJS.Workbook();wb.creator='UTM Desk';wb.created=new Date();
 // --- Hoja 1: Incidencias
 const ws=wb.addWorksheet('Incidencias');
 ws.columns=[['Folio',16],['Título',40],['Categoría',34],['Prioridad',11],['Estado',12],['Edificio',14],['Espacio',22],['Reportante',24],['Correo',28],['Técnico',22],['Etiquetas',26],['Creación',17],['Resolución',17],['Horas hasta resolver',12],['Horas trabajadas',12],['Evidencias',10]].map(([header,width])=>({header,width}));
 const hrs=(i)=>i.fechaResolucion?+((i.fechaResolucion-i.createdAt)/36e5).toFixed(2):null;
 L.forEach(i=>{const r=ws.addRow([i.folio,i.titulo,i.categoria,i.prioridad,i.estado,i.edificio,i.espacio||'',i.reportante?.nombre,i.reportante?.email,i.tecnico?.nombre||'Sin asignar',(i.etiquetas||[]).map(t=>'#'+t).join(' '),i.createdAt,i.fechaResolucion||null,hrs(i),+(i.historial||[]).reduce((a,h)=>a+(h.horas||0),0).toFixed(2),(i.evidencias||[]).length]);
  r.getCell(12).numFmt=fmt;r.getCell(13).numFmt=fmt;
  if(i.prioridad==='Urgente')r.getCell(4).font={bold:true,color:{argb:'FFB91C1C'}};
  if(i.estado==='Abierta')r.getCell(5).font={color:{argb:'FFB91C1C'}}});
 head(ws);
 // --- Hoja 2: Intervenciones (historial plano)
 const wi=wb.addWorksheet('Intervenciones');
 wi.columns=[['Folio',16],['Fecha',17],['Autor',22],['Tipo',14],['Estado anterior',14],['Estado nuevo',14],['Horas',8],['Comentario',70]].map(([header,width])=>({header,width}));
 L.forEach(i=>(i.historial||[]).forEach(h=>{const r=wi.addRow([i.folio,h.fecha,h.autor,h.tipo,h.estadoAnterior||'',h.estadoNuevo||'',h.horas||0,h.comentario||'']);r.getCell(2).numFmt=fmt;r.getCell(8).alignment={wrapText:true}}));
 head(wi);
 // --- Hoja 3: Resumen (fórmulas vivas sobre la hoja Incidencias)
 const rs=wb.addWorksheet('Resumen',{views:[{showGridLines:false}]});rs.columns=[{width:40},{width:16},{width:22}];
 rs.addRow(['UTM Desk – Control administrativo']).font={bold:true,size:15,color:{argb:G}};
 rs.addRow(['Generado',new Date().toLocaleString('es-MX')]);if(filtros)rs.addRow(['Filtros aplicados',filtros]);
 rs.addRow(['Total de incidencias',{formula:'COUNTA(Incidencias!A:A)-1',result:L.length}]).font={bold:true};rs.addRow([]);
 const sec=(t,h,rows)=>{const r=rs.addRow([t]);r.font={bold:true,color:{argb:'FFFFFFFF'}};r.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:G}});rs.getRow(r.number).getCell(2).fill=r.getCell(1).fill;rs.getRow(r.number).getCell(3).fill=r.getCell(1).fill;
  rs.addRow(h).font={bold:true};rows.forEach(x=>rs.addRow(x));rs.addRow([])};
 const cnt=(col,v,key)=>[v,{formula:`COUNTIF(Incidencias!$${col}:$${col},"${v}")`,result:L.filter(x=>x[key]===v).length}];
 sec('Incidencias por estado',['Estado','Total'],ESTADOS.map(v=>cnt('E',v,'estado')));
 sec('Incidencias por categoría',['Categoría','Total'],CATS.map(v=>cnt('C',v,'categoria')));
 sec('Incidencias por prioridad',['Prioridad','Total'],PRIOS.map(v=>cnt('D',v,'prioridad')));
 const eds=[...new Set(L.map(x=>x.edificio).filter(Boolean))].sort();
 sec('Por edificio',['Edificio','Total','Horas promedio de resolución'],eds.map(e=>{const done=L.filter(x=>x.edificio===e&&x.fechaResolucion).map(hrs);
  return[e,{formula:`COUNTIF(Incidencias!$F:$F,"${e}")`,result:L.filter(x=>x.edificio===e).length},{formula:`IFERROR(ROUND(AVERAGEIFS(Incidencias!$N:$N,Incidencias!$F:$F,"${e}"),2),"")`,result:done.length?+(done.reduce((a,b)=>a+b,0)/done.length).toFixed(2):''}]}));
 const tags={};L.forEach(i=>(i.etiquetas||[]).forEach(t=>tags[t]=(tags[t]||0)+1));
 sec('Top 10 etiquetas',['Etiqueta','Total'],Object.entries(tags).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([t,n])=>['#'+t,n]));
 wb.views=[{activeTab:2}];return wb}
