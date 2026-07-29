import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Database = NeonHttpDatabase<typeof schema>;

/**
 * Lazily create a Drizzle database instance from a Neon connection string.
 * The Neon serverless driver uses HTTP fetch under the hood, making it
 * compatible with Cloudflare Workers (no WebSocket required).
 *
 * @param databaseUrl - Neon connection string (postgresql://...)
 */
export function createDatabase(databaseUrl: string): Database {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Set it in .dev.vars locally or via `wrangler secret put DATABASE_URL`.",
    );
  }
  const sql: NeonQueryFunction<false, false> = neon(databaseUrl);
  return drizzle(sql, { schema });
}
