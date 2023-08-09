import run from "node-pg-migrate";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const connStr = process.env.DATABASE_DSN_REFERRAL;
  if (connStr == undefined) {
    Error("run_migrate: database string not defined");
  }
  try {
    await run({
      migrationsTable: "pgmigrations",
      dir: "./src/migrations",
      direction: "up",
      databaseUrl: connStr!,
    });

    console.log("Migrations successfully applied");
  } catch (error) {
    console.error("Error applying migrations:", error);
    process.exit(1);
  }
}

main();
