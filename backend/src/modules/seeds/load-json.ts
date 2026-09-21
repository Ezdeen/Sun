/**
 * JSON seed loader with schema sanity checks (fail fast on malformed data).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");

export function loadJson<T>(filename: string): T[] {
  const raw = readFileSync(join(DATA_DIR, filename), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`seed file ${filename} must be a JSON array`);
  }
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      throw new Error(`seed file ${filename} contains a non-object entry`);
    }
  }
  return parsed as T[];
}
