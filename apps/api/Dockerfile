# syntax=docker/dockerfile:1
# Contexte de build : apps/api  →  docker build -t branche-api apps/api

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "dist/server.js"]
