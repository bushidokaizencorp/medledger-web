# MedLedger ERP — production image
FROM node:22-slim AS base
WORKDIR /app

# Build deps for native modules (argon2, better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

# Run as a non-root user
RUN groupadd -r medledger && useradd -r -g medledger medledger \
    && chown -R medledger:medledger /app
USER medledger

ENV NODE_ENV=production
EXPOSE 8080

# Basic container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
