// Lectura del lote de demostración (`datos-demo/*.json`).
//
// Esos archivos se exportaron con mongosh, así que traen EJSON: `{"$oid":"…"}`, `{"$date":"…"}`.
// Insertarlos tal cual falla en el driver (`_id fields may not contain '$'-prefixed fields`), por
// eso se convierten aquí a los tipos reales antes de pasarlos a Mongoose.

import { readFileSync } from 'node:fs';
import { Types } from 'mongoose';

const ESCALARES = { $oid: v => new Types.ObjectId(v), $date: v => new Date(v),
    $numberInt: Number, $numberLong: Number, $numberDouble: Number };

export const leEJSON = v => {
    if (Array.isArray(v)) return v.map(leEJSON);
    if (!v || typeof v !== 'object') return v;
    const claves = Object.keys(v);
    if (claves.length === 1 && ESCALARES[claves[0]]) return ESCALARES[claves[0]](v[claves[0]]);
    return Object.fromEntries(claves.map(k => [k, leEJSON(v[k])]));
};

export const cargaDemo = nombre =>
    leEJSON(JSON.parse(readFileSync(new URL(`datos-demo/${nombre}.json`, import.meta.url), 'utf8')));
