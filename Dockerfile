# --- base ---
FROM node:22-slim AS base
WORKDIR /app

# --- dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- runtime ---
FROM base AS runtime
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