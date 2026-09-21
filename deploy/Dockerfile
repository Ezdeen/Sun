# ── Stage 1: build web (React + Vite) ────────────────────────────────────
FROM node:24-alpine AS webbuild
WORKDIR /build
RUN corepack enable
COPY pnpm-workspace.yaml package.json ./
COPY web/package.json web/
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --filter @waste/web... --filter @waste/backend...
COPY web web
COPY openapi.json ./
RUN cd web && pnpm gen:api && pnpm build

# ── Stage 2: build backend (TypeScript → dist) ───────────────────────────
FROM node:24-alpine AS backendbuild
WORKDIR /build
RUN corepack enable
COPY pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --filter @waste/backend...
COPY backend backend
RUN cd backend && pnpm build

# ── Stage 3: production runtime (non-root) ───────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production APP_ENV=production PORT=8080
WORKDIR /app
RUN corepack enable && addgroup -S app && adduser -S app -G app

COPY --from=backendbuild /build/backend/dist ./backend/dist
COPY --from=backendbuild /build/backend/node_modules ./backend/node_modules
COPY --from=backendbuild /build/node_modules ./node_modules
COPY --from=backendbuild /build/backend/package.json ./backend/package.json
COPY --from=webbuild /build/web/dist ./web/dist
COPY pnpm-workspace.yaml package.json ./

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/dist/main.js"]
