// Container health check. Distroless has no shell or curl, so this runs on the image's Node.
const port = process.env.PORT ?? "8787";
try {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
    signal: AbortSignal.timeout(4000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
