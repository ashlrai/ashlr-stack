/**
 * Codegen script: generate TypeScript types from all registered provider schemas.
 * Run with: bun packages/core/scripts/gen-provider-types.ts
 *
 * Writes one file per provider to packages/core/generated/<provider>-schema.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateTypeScript,
  getProviderSchema,
  listRegisteredSchemas,
} from "../src/provision-schema.ts";

const outDir = join(import.meta.dir, "..", "generated");

await mkdir(outDir, { recursive: true });

const schemas = listRegisteredSchemas();
let generated = 0;
let skipped = 0;

for (const name of schemas) {
  const schema = getProviderSchema(name);
  if (!schema) {
    skipped++;
    continue;
  }
  const code = generateTypeScript(name, schema);
  const outPath = join(outDir, `${name}-schema.ts`);
  await writeFile(outPath, code, "utf-8");
  generated++;
}

console.log(`Codegen complete: ${generated} files written to ${outDir} (${skipped} skipped)`);
