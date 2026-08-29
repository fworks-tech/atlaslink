# --- base ---
FROM node:22-slim AS base
WORKDIR /app

# --- agenthood sibling (the package.json declares a `file:../agenthood` dep) ---
# Mirrors CI (which checks both repos out as siblings and builds agenthood
# first). agenthood is public on GitHub and also published to npm. Must stay at
# /agenthood: npm links file:../agenthood as ../agenthood from /app, so the
# image must match the sibling layout the symlink expects.
FROM base AS agenthood-src
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/fworks-tech/agenthood.git /agenthood
WORKDIR /agenthood
RUN npm ci && npm run build

# --- app dependencies ---
FROM base AS deps
# stage the sibling before npm ci so the file: dependency resolves to a real
# package during install (npm links it; the build output is discarded here)
COPY --from=agenthood-src /agenthood /agenthood
COPY package.json package-lock.json ./
RUN npm ci

# --- runtime ---
FROM base AS runtime
ENV ATLASLINK_HOST=0.0.0.0 \
    NODE_ENV=production
# package.json is read at startup for the version banner (src/server.ts)
COPY --from=deps /app/node_modules ./node_modules
# agenthood must be at /agenthood (absolute) — the node_modules symlink created
# by npm for file:../agenthood resolves there, not under /app
COPY --from=agenthood-src /agenthood /agenthood
COPY src ./src
COPY package.json ./
COPY tsconfig.json ./
# the agenthood config (provider + defaults) the daemon loads from cwd
COPY .agenthood/config.json ./.agenthood/config.json
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/server.ts"]