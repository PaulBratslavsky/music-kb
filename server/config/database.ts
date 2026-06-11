import path from 'path';
import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Database => {
  // Local-first dev / Neon-in-prod split: `strapi develop`
  // (NODE_ENV=development) always uses a local throwaway SQLite, so dev
  // is offline and never touches cloud data. Everything else —
  // `strapi start`, and CLI commands run with NODE_ENV=production — uses
  // the configured client (Neon Postgres). The two databases are
  // independent; move data between them with the db:dump:* / db:load:*
  // scripts (see docs/operations.md "Local SQLite ↔ Neon").
  const client =
    env('NODE_ENV', 'development') === 'development'
      ? 'sqlite'
      : env('DATABASE_CLIENT', 'postgres');

  // Neon's pooled (PgBouncer) endpoint breaks Strapi's boot migrations —
  // advisory locks and session-level state don't survive transaction
  // pooling. Fail fast with a fix instead of a cryptic migration error.
  // Only checked when postgres is actually selected, so SQLite dev boot
  // is untouched.
  if (client === 'postgres' && env('DATABASE_HOST', '').includes('-pooler.')) {
    throw new Error(
      `DATABASE_HOST points at Neon's pooled (PgBouncer) endpoint (${env('DATABASE_HOST')}). ` +
        "Strapi's boot migrations fail through the pooler — use the direct endpoint instead " +
        '(remove `-pooler` from the host).',
    );
  }

  const connections = {
    mysql: {
      connection: {
        host: env('DATABASE_HOST', 'localhost'),
        port: env.int('DATABASE_PORT', 3306),
        database: env('DATABASE_NAME', 'strapi'),
        user: env('DATABASE_USERNAME', 'strapi'),
        password: env('DATABASE_PASSWORD', 'strapi'),
        ssl: env.bool('DATABASE_SSL', false) && {
          key: env('DATABASE_SSL_KEY', undefined),
          cert: env('DATABASE_SSL_CERT', undefined),
          ca: env('DATABASE_SSL_CA', undefined),
          capath: env('DATABASE_SSL_CAPATH', undefined),
          cipher: env('DATABASE_SSL_CIPHER', undefined),
          rejectUnauthorized: env.bool('DATABASE_SSL_REJECT_UNAUTHORIZED', true),
        },
      },
      pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 10) },
    },
    postgres: {
      connection: {
        host: env('DATABASE_HOST', 'localhost'),
        port: env.int('DATABASE_PORT', 5432),
        database: env('DATABASE_NAME', 'strapi'),
        user: env('DATABASE_USERNAME', 'strapi'),
        password: env('DATABASE_PASSWORD', 'strapi'),
        ssl: env.bool('DATABASE_SSL', false) && {
          key: env('DATABASE_SSL_KEY', undefined),
          cert: env('DATABASE_SSL_CERT', undefined),
          ca: env('DATABASE_SSL_CA', undefined),
          capath: env('DATABASE_SSL_CAPATH', undefined),
          cipher: env('DATABASE_SSL_CIPHER', undefined),
          rejectUnauthorized: env.bool('DATABASE_SSL_REJECT_UNAUTHORIZED', true),
        },
        schema: env('DATABASE_SCHEMA', 'public'),
      },
      pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 10) },
    },
    sqlite: {
      connection: {
        filename: path.join(__dirname, '..', '..', env('DATABASE_FILENAME', '.tmp/music-kb.db')),
      },
      useNullAsDefault: true,
    },
  };

  return {
    connection: {
      client,
      ...connections[client],
      acquireConnectionTimeout: env.int('DATABASE_CONNECTION_TIMEOUT', 60000),
    },
  };
};

export default config;
