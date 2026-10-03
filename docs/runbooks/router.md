# Runbook: Cosmo Router — graph edge

The router is the single entry point of the federated graph (ADR-011).
Locally it runs tokenless: composition reads the checked-in subgraph schemas,
never the Cosmo Cloud control plane.

## Commands

| Command | What it does |
|---|---|
| `npm run compose` | Composes `src/subgraphs/compose.yaml` into `router-config.json` (gitignored). Hermetic — the CI gate. |
| `npm run router` | Composes, downloads the router binary once (`tools/router/`), writes routing overrides, serves the supergraph on `http://localhost:3002/graphql`. |
| `npm run router:smoke` | Opt-in e2e check: app on a temp data dir + router on a free port, one query per subgraph plus a `task→session` entity hop. Non-zero exit on failure. Never runs inside `npm test`. |

## Files

- `router.yaml` (committed) — runtime config: `dev_mode: false` (JSON logs; `dev_mode: true` silently disables them), `listen_addr`, execution config path.
- `router.overrides.yaml` (generated, gitignored) — `overrides.subgraphs.<name>.routing_url` for the current environment, loaded **after** `router.yaml` so it wins the merge.
- `router-config.json` (composed, gitignored) — the execution config; static, so restart the router after schema changes (`npm run router` re-composes every start).
- `tools/router/` (gitignored) — downloaded binary (`wgc router download-binary`).

## Environment

- `ATLASLINK_APP_URL` — where the router reaches the app (default `http://127.0.0.1:3000`). Set it when the app is not on loopback: `ATLASLINK_APP_URL=http://app:3000 npm run router`.
- `ATLASLINK_PORT` / `ATLASLINK_DATA_DIR` — app side; the smoke run fixes both to keep `data/` untouched.

## Health gate

| Endpoint | Meaning |
|---|---|
| `GET /health/ready` | **Gate**: `OK` only when the router can serve GraphQL. |
| `GET /health/live` | Process is alive. |
| `GET /health` | Default health check path. |

Operator rule: no traffic before `/health/ready` answers `OK`; check it again after every restart or config change.

Metrics: `http://127.0.0.1:8088/metrics` (Prometheus). Playground: `http://localhost:3002/` (query at `/graphql`).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Failed to fetch from Subgraph '<name>'` | App not reachable at `ATLASLINK_APP_URL`. Start the app or fix the URL. |
| `Could not load config ... validation error` | Invalid key in a router yaml (validation is fatal, not a warning). Compare with the schema keys: `listen_addr`, `execution_config.file.path`, `overrides.subgraphs`. |
| `No graph token provided` warning | Expected in local mode — Cosmo Cloud features (metrics, schema usage) are off. ADR-011 chose tokenless operation on purpose. |
| `GOMEMLIMIT was not set` warning | Benign outside containers; set `GOMEMLIMIT` in production. |
| Binary missing / download fails | `npx --yes wgc@0.132.2 router download-binary -o tools/router`, then retry. |

## Optional: Cosmo Cloud (Studio)

Not required by ADR-011. To connect the local graph to Studio later: create an
API key in the Studio UI (`API Keys`), then `wgc graph create` /
`wgc subgraph publish` with `COSMO_API_KEY`, and `wgc router fetch` replaces
the local `npm run compose` output. Local development stays tokenless.
