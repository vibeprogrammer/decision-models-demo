// Tiny .env loader (no dependency). Real environment variables win over .env.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function loadEnv(dir = process.cwd()) {
  const file = join(dir, ".env");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = val;
  }
}
