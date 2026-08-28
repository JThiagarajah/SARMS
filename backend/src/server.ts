import app from "./app";
import { initDb } from "./db/client";

const PORT = Number(process.env.PORT ?? 4000);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`SARMS backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Could not connect to the database / apply schema:", err);
    process.exit(1);
  });
