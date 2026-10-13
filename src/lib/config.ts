import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Bootstrap config: the one thing that can't live in the database is where
// the database is. The setup screen saves it to data/config.json; a
// MONGODB_URI environment variable (e.g. on a server) takes precedence.
// Everything else is stored in MongoDB and edited on the Settings page.

interface LocalConfig {
  mongodbUri?: string;
}

const CONFIG_PATH = path.join(process.cwd(), "data", "config.json");

function readLocalConfig(): LocalConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as LocalConfig;
  } catch {
    return {};
  }
}

export function getMongoUri(): string | null {
  return process.env.MONGODB_URI || readLocalConfig().mongodbUri || null;
}

/** True when the URI comes from the environment and can't be changed from the app. */
export function isMongoUriFromEnv(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

export function saveMongoUri(uri: string): void {
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...readLocalConfig(), mongodbUri: uri }, null, 2) + "\n", "utf8");
}

export function isValidMongoUri(uri: string): boolean {
  return /^mongodb(\+srv)?:\/\/\S+$/.test(uri.trim());
}
