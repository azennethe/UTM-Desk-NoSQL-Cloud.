const { MongoClient } = require("mongodb");

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  try {
    const db = client.db("utm-desk");
    const usuarios = await db.collection("users")
      .find({}, { projection: { nombre: 1, email: 1, rol: 1 } })
      .toArray();

    console.log("USUARIOS DE LA APLICACIÓN:");
    console.log(JSON.stringify(usuarios, null, 2));

    const incidencias = await db.collection("incidencias").find(
      {},
      { projection: { folio: 1, "reportante.id": 1, "reportante.email": 1 } }
    ).toArray();

    console.log("\nREPORTANTES DE LAS INCIDENCIAS ACTUALES:");
    console.log(JSON.stringify(incidencias, null, 2));
  } finally {
    await client.close();
  }
})().catch(err => {
  console.error("Error:", err.message);
  process.exitCode = 1;
});
