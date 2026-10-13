// Optional: a local MongoDB for development/testing without Atlas.
//   npm run mongo:local   -> mongodb://127.0.0.1:27017 (data kept in data/mongo-dev)
// The first run downloads the MongoDB server binary (~100 MB) into the npm cache.
import { mkdirSync } from "node:fs";
import { MongoMemoryServer } from "mongodb-memory-server";

async function main() {
  mkdirSync("data/mongo-dev", { recursive: true });
  const server = await MongoMemoryServer.create({
    instance: { port: 27017, ip: "127.0.0.1", dbPath: "data/mongo-dev", storageEngine: "wiredTiger" },
  });
  console.log(`[mongo] local MongoDB running at ${server.getUri()} (Ctrl+C to stop)`);
  const stop = async () => {
    await server.stop({ doCleanup: false, force: false });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error("[mongo] failed to start:", err);
  process.exit(1);
});
