// Must be the first import of the worker entry point: Next.js loads .env for
// the web app automatically, but the standalone worker process does not.
// Nothing is required there (the database comes from data/config.json and
// everything else from the Settings page); it only carries optional server
// overrides such as MONGODB_URI and AUTH_SECRET.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file - rely on the real environment
}
