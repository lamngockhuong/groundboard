# syntax=docker/dockerfile:1
#
# groundboard web viewer, render API and MCP endpoint.
# Build from the repository root:  docker build -f docker/Dockerfile -t groundboard .

FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS build
WORKDIR /src
# Node 25 and later ship without corepack; install the pnpm version package.json pins.
COPY package.json ./
RUN npm install -g "$(node -p 'require("./package.json").packageManager')" --no-audit --no-fund
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store
RUN pnpm -r build
# Install exactly what npm publishes: the staged package (built output, LICENSE, generated
# THIRD_PARTY_NOTICES.md) with its shrinkwrapped production dependencies.
RUN node scripts/pack.mjs --stage /out --out /tmp/pack \
    && cd /out \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && rm -rf /tmp/pack
COPY docker/healthcheck.mjs /out/healthcheck.mjs

FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:ffa8a7545403036c94ec76674b5dbac2d425af2d679147cdf3e30180071487b7
WORKDIR /app
COPY --from=build /out /app
ENV NODE_ENV=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/nodejs/bin/node", "/app/healthcheck.mjs"]
ENTRYPOINT ["/nodejs/bin/node", "/app/dist/cli.mjs"]
CMD ["serve", "--host", "0.0.0.0", "--port", "8787"]
