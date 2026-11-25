import { writeFileSync } from "node:fs";
import path from "node:path";
import { boardJsonSchemaText } from "../src/json-schema.ts";

const out = path.join(import.meta.dirname, "..", "board.schema.json");
writeFileSync(out, boardJsonSchemaText());
console.log(`wrote ${path.relative(process.cwd(), out)}`);
