// Load .env before any test module imports config
try {
  process.loadEnvFile('.env');
} catch {
  // .env may not exist in CI — rely on process.env
}
