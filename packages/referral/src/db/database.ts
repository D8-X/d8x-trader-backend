import { Pool, Client } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import * as dotenv from "dotenv";
import { Database } from "./db_types";

// see https://kysely.dev/docs/getting-started#instantiation

export async function createKyselyDBInstance(): Promise<Kysely<Database>> {
  dotenv.config();

  // see also https://node-postgres.com/features/connecting
  const connStr = process.env.DATABASE_DSN_REFERRAL;
  console.log(`Connecting to "${connStr}"`);
  const dialect = new PostgresDialect({
    //https://github.com/brianc/node-postgres/blob/cf24ef28ee2134b63576afba341452f8adfb8a4d/packages/pg-pool/index.js#L67
    pool: new Pool({
      connectionString: connStr,
      max: 10,
    }),
  });

  // Database interface is passed to Kysely's constructor, and from now on, Kysely
  // knows your database structure.
  // Dialect is passed to Kysely's constructor, and from now on, Kysely knows how
  // to communicate with your database.
  const db = new Kysely<Database>({
    dialect,
  });
  return db;
}
