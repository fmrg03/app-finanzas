# Imagen de la API. Se construye desde la raíz del repo:
#   docker build -f apps/api/Dockerfile -t finanzas-api .
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @finanzas/api... --ignore-scripts
COPY apps/api apps/api
RUN pnpm --filter @finanzas/api exec prisma generate && pnpm --filter @finanzas/api build
# Copia autónoma solo con dependencias de producción, y su propio cliente Prisma generado
RUN pnpm --filter @finanzas/api deploy --prod --ignore-scripts /out \
  && cp -r apps/api/dist apps/api/prisma /out/ \
  && cd /out && npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://localhost:'+(process.env.API_PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Aplica las migraciones pendientes y arranca
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
