import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Backend tests need a Postgres connection string ' +
      '(copy backend/.env.example to backend/.env and fill it in).'
  );
}

// Tests must never run against a developer's real data. Force a dedicated
// "<database>_test" database, derived from DATABASE_URL, regardless of what
// the configured database name is.
//
// One-time setup before running `npm test`:
//   createdb <database>_test
//   DATABASE_URL=postgresql://.../<database>_test npx prisma migrate deploy
if (!/\/[^/?]+_test(\?|$)/.test(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /\/([^/?]+)(\?|$)/,
    '/$1_test$2'
  );
}
