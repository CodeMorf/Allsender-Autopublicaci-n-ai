#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function log(message) {
  const dir = path.join(ROOT, 'storage', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'polar-global-first.log'), `[${new Date().toISOString()}] ${message}\n`);
  console.log(message);
}

loadEnv(path.join(ROOT, '.env'));

const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.DRIZZLE_DATABASE_URL || '';
if (!databaseUrl) {
  log('Conexión de datos no disponible para preparar Polar global.');
  process.exit(2);
}

let PgClient;
try {
  const pg = await import('pg');
  PgClient = (pg.default || pg).Client;
} catch {
  log('Dependencia de base de datos no disponible.');
  process.exit(2);
}

const migrationPath = path.join(ROOT, 'migrations', '20260614_polar_global_first.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const client = new PgClient({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  await client.query(sql);
  log('Polar global preparado correctamente.');
} finally {
  await client.end().catch(() => {});
}
