import { readFile } from "node:fs/promises";
import type { Issue } from "@groundboard/schema";

export const EXIT = { ok: 0, io: 1, usage: 2, invalid: 3 } as const;

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  cwd: string;
}

export class CliError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, message: string) {
    super(message);
    this.exitCode = exitCode;
  }
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export const processIO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin,
  cwd: process.cwd(),
};

/** Reads and parses a board file (`-` for stdin). I/O failures exit 1, bad JSON exits 3. */
export async function readJsonInput(file: string, io: CliIO): Promise<unknown> {
  let text: string;
  try {
    text = file === "-" ? await io.readStdin() : await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "error";
    throw new CliError(EXIT.io, `cannot read ${file}: ${code}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(EXIT.invalid, `${file} is not valid JSON: ${(error as Error).message}`);
  }
}

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `  ${i.path === "" ? "(board)" : i.path}: ${i.message}\n`).join("");
}
