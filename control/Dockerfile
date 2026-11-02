# Houdini Production Control — no npm dependencies, so the image is the Node runtime plus the app files.
# Build:  docker build -t koprifossillab/houdini-control:<version> control/
FROM node:22.22.1-alpine3.22

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8097 \
    HPC_BASE_PATH=/Houdini \
    HPC_AUTH=basic \
    HPC_COLLECTOR_DIR=/data/collector \
    HPC_LEDGER_DIR=/data/ledger \
    HPC_MEDIA_DIR=/data/media \
    HPC_MEDIA_MANIFEST=/data/runtime/media.json

WORKDIR /app
COPY --chown=root:root package.json server.mjs ./
COPY --chown=root:root lib ./lib
COPY --chown=root:root public ./public
COPY --chown=root:root data ./data
COPY --chown=root:root scripts ./scripts

# app files are root-owned and read-only for the runtime user
USER node
EXPOSE 8097
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8097/Houdini/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
