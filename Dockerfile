# ── Stage 1: install production deps ─────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# tini: proper PID-1 signal forwarding (fixes SIGTERM not reaching Node)
RUN apk add --no-cache tini

# Non-root user
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json ./
COPY --chown=app:app src ./src
COPY --chown=app:app server.js ./

USER app

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# tini wraps Node so SIGTERM/SIGINT work correctly
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--max-old-space-size=256", "server.js"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
