FROM node:24.22.2-alpine AS base
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY api/package.json api/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @corridas/api
COPY tsconfig.base.json ./
COPY api/ api/
RUN pnpm --filter @corridas/api exec prisma generate && pnpm --filter @corridas/api build

FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --filter @corridas/api --prod
COPY api/prisma api/prisma
COPY api/prisma.config.ts api/
COPY --from=build /repo/api/dist api/dist
USER node
WORKDIR /repo/api
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
