import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { createApp } from "../server/app.ts";
import { resolveAtlasPaths } from "./atlas.ts";
import { CliError, type CliIO, EXIT } from "./io.ts";

export const serveHelp = `Usage: groundboard serve [options]

Serve the web viewer, POST /api/render, POST /api/validate, the MCP endpoint /mcp
(Streamable HTTP, no file access) and GET /healthz. The server reads no files unless
started with --atlas.

Options:
      --port <n>           Port (default 8787)
      --host <addr>        Address to bind (default 127.0.0.1)
      --trust-proxy <cidr> Believe X-Forwarded-For from this proxy range; repeatable
      --atlas              Also serve the screen atlas: the viewer lists the boards,
                           GET /api/atlas indexes them, GET /api/atlas/boards/<name> renders one.
                           On 127.0.0.1 the viewer can also edit a board's tags, which
                           PUT /api/atlas/boards/<name>/tags writes into its file
      --root <path>        With --atlas: project root sources are checked against (default .)
      --atlas-dir <path>   With --atlas: directory of *.board.json inside the root
                           (default <root>/.groundboard)
  -h, --help               Show this help

With --atlas on an address other than loopback, both GROUNDBOARD_TOKEN and
GROUNDBOARD_ALLOWED_HOSTS must be set, or the server refuses to start.

Environment:
  GROUNDBOARD_ALLOWED_HOSTS  Comma-separated hostnames accepted in Host and Origin headers
  GROUNDBOARD_TOKEN          Require "Authorization: Bearer <token>" on /api/* and /mcp
`;

export async function serveCommand(args: string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "trust-proxy": { type: "string", multiple: true },
      atlas: { type: "boolean" },
      root: { type: "string" },
      "atlas-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    io.stdout(serveHelp);
    return EXIT.ok;
  }
  const port = Number(values.port ?? process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new CliError(
      EXIT.usage,
      `--port must be a port number, not ${JSON.stringify(values.port)}`,
    );
  }
  const host = values.host ?? "127.0.0.1";
  const allowedHosts = (process.env.GROUNDBOARD_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h !== "");
  const token = process.env.GROUNDBOARD_TOKEN || undefined;
  if (!values.atlas && (values.root !== undefined || values["atlas-dir"] !== undefined)) {
    throw new CliError(EXIT.usage, "--root and --atlas-dir only apply with --atlas");
  }
  const atlas = values.atlas
    ? await resolveAtlasPaths(io.cwd, values.root, values["atlas-dir"], "--atlas-dir")
    : undefined;
  let built: ReturnType<typeof createApp>;
  try {
    built = createApp({
      host,
      allowedHosts,
      ...(token ? { token } : {}),
      ...(values["trust-proxy"] ? { trustProxy: values["trust-proxy"] } : {}),
      ...(atlas ? { atlas } : {}),
    });
  } catch (error) {
    throw new CliError(EXIT.usage, (error as Error).message);
  }
  const server = serve({ fetch: built.app.fetch, port, hostname: host }, (info) => {
    io.stderr(
      `groundboard ${host === "0.0.0.0" || host === "::" ? "listening on all interfaces" : "listening"} at http://${host.includes(":") ? `[${host}]` : host}:${info.port}` +
        `${token ? " (bearer token required on /api and /mcp)" : ""}` +
        `${atlas ? `, serving the atlas in ${atlas.dir}` : ""}\n`,
    );
  });
  await new Promise<void>((resolve) => {
    const stop = () => {
      server.close(() => resolve());
      void built.close();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return EXIT.ok;
}
