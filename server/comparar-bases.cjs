const { MongoClient } = require("mongodb");

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  try {
    for (const dbName of ["UTM_Desk", "utm-desk"]) {
      const db = client.db(dbName);
      console.log("\n========== BASE:", dbName, "==========");

      for (const nombre of await db.listCollections().toArray()) {
        const col = db.collection(nombre.name);
        const total = await col.countDocuments();
        console.log(`\n${nombre.name}: ${total} documentos`);

        if (total > 0 && ["Usuarios", "users", "incidencias_campus", "incidencias"].includes(nombre.name)) {
          const doc = await col.findOne({});
          if (nombre.name === "Usuarios" || nombre.name === "users") {
            delete doc.password;
          }
          console.log(JSON.stringify(doc, (key, value) =>
            /password|token|secret/i.test(key) ? "[OCULTO]" : value, 2));
        }
      }
    }
  } finally {
    await client.close();
  }
})().catch(err => {
  console.error("Error:", err.message);
  process.exitCode = 1;
});
