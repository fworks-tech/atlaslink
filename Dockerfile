# --- base ---
FROM node:22-slim AS base
WORKDIR /app

# --- dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- router (deploy #328): Cosmo Router with hermetic, baked-in configs ---
FROM base AS router
# Platform-matching router binary (linux/amd64 or linux/arm64 on t4g.micro)
RUN npx --yes wgc@0.132.2 router download-binary -o /opt/cosmo
WORKDIR /config
# Static runtime config + AWS overlay (0.0.0.0 listen, docker-internal subgraph URLs)
COPY router.yaml deploy/aws/router.overrides.yaml ./
# Subgraph schemas + composition input for the hermetic compose below
# (same result as `npm run compose`, no control plane)
COPY src/subgraphs /src/subgraphs
RUN npx --yes wgc@0.132.2 router compose -i /src/subgraphs/compose.yaml -o router-config.json
EXPOSE 3002
ENTRYPOINT ["/opt/cosmo/router"]
CMD ["-config", "router.yaml,router.overrides.yaml"]

# --- runtime ---
FROM base AS runtime
# git backs the workspace (ADR-012) — the files subgraph shells out to it
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
ENV ATLASLINK_HOST=0.0.0.0 \
    NODE_ENV=production \
    ATLASLINK_SQLITE_DIR=/app/data/atlaslink.sqlite
# package.json is read at startup for the version banner (src/server.ts)
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./
COPY tsconfig.json ./
# the agenthood config (provider + defaults) the daemon loads from cwd
COPY .agenthood/config.json ./.agenthood/config.json
# SQLite persists its database here; the daemon binds /app/data to a volume
# so sessions survive restarts.
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/server.ts"]
