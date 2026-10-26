const { MongoClient } = require("mongodb");

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  const db = client.db();

  for (const nombre of ["users", "incidencias", "counters", "articulos"]) {
    const col = db.collection(nombre);
    const doc = await col.findOne({});

    console.log("\nCOLECCION:", nombre);
    if (!doc) {
      console.log("Sin documentos");
      continue;
    }

    if (nombre === "users") {
      delete doc.password;
    }

    console.log(JSON.stringify(doc, (key, value) =>
      /password|token|secret/i.test(key) ? "[OCULTO]" : value, 2));
  }

  await client.close();
})().catch(err => {
  console.error("Error al consultar MongoDB:", err.message);
  process.exitCode = 1;
});
