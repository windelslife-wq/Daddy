# syntax=docker/dockerfile:1
# Production image for Faceless Studio (API + built React/PWA frontend).
# The same image runs the API, dedicated workers, and one-shot DB bootstrap.
FROM node:22-bookworm

WORKDIR /app

# ffmpeg is required for real video rendering; build tools compile better-sqlite3.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 make g++ ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
 && npm prune --omit=dev \
 && npm cache clean --force \
 && mkdir -p /app/data /app/storage \
 && chown -R node:node /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TRUST_PROXY=true \
    SECURE_COOKIES=true \
    WORKER_ENABLED=false \
    SEED_DEMO=false \
    DATA_DIR=/app/data \
    STORAGE_DIR=/app/storage

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/meta/health" >/dev/null || exit 1

CMD ["node", "server/index.js"]
