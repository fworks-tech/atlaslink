# --- router (deploy #328): Cosmo Router with hermetic, baked-in configs ---
FROM node:22-slim AS router
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
