#!/usr/bin/env node
import { run } from "./commands/index.ts";
import { processIO } from "./commands/io.ts";

process.exitCode = await run(process.argv.slice(2), processIO);
