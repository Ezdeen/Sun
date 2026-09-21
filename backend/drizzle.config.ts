import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: process.env.ENV_FILE ?? ".env" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shared/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ""
  }
});
