# ============================================================
# Stage 1: Build
# ============================================================
FROM node:20-slim AS builder

RUN npm install -g pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ============================================================
# Stage 2: Production runtime
# ============================================================
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
# ABI files are needed at runtime to interact with contracts
COPY --from=builder /app/src/abi ./dist/abi

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD node -e "require('http').get('http://localhost:3001/', r => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

CMD ["node", "dist/main.js"]
