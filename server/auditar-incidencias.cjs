const { MongoClient } = require("mongodb");

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  try {
    const db = client.db("utm-desk");
    const origen = await db.collection("incidencias_campus").find({}).toArray();
    const destino = await db.collection("incidencias").find(
      {},
      { projection: { folio: 1 } }
    ).toArray();

    const frecuencias = (campo) => {
      const conteo = {};
      for (const doc of origen) {
        const valor = campo(doc) ?? "(sin dato)";
        conteo[valor] = (conteo[valor] || 0) + 1;
      }
      return conteo;
    };

    const foliosDestino = new Set(destino.map(x => x.folio));
    const conflictos = origen
      .filter(x => foliosDestino.has(x.folio))
      .map(x => x.folio);

    console.log("Total de incidencias por revisar:", origen.length);
    console.log("\nCATEGORÍAS:");
    console.log(JSON.stringify(frecuencias(x => x.categoria), null, 2));

    console.log("\nPRIORIDADES:");
    console.log(JSON.stringify(frecuencias(x => x.prioridad), null, 2));

    console.log("\nESTADOS:");
    console.log(JSON.stringify(frecuencias(x => x.estado), null, 2));

    console.log("\nDOCUMENTOS SIN FOLIO:");
    console.log(origen.filter(x => !x.folio).length);

    console.log("\nFOLIOS REPETIDOS ENTRE COLECCIONES:");
    console.log(JSON.stringify(conflictos, null, 2));

    console.log("\nINCIDENCIAS SIN TÍTULO O DESCRIPCIÓN:");
    console.log(origen.filter(x => !x.titulo || !x.descripcion).length);

    console.log("\nFECHAS DE REPORTE INVÁLIDAS:");
    console.log(origen.filter(x =>
      !x.fecha_reporte || Number.isNaN(Date.parse(x.fecha_reporte))
    ).length);
  } finally {
    await client.close();
  }
})().catch(err => {
  console.error("Error:", err.message);
  process.exitCode = 1;
});
