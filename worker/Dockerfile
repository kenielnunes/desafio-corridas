FROM node:24.22.2-alpine AS base
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY worker/package.json worker/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @corridas/worker
COPY tsconfig.base.json ./
COPY worker/ worker/
RUN pnpm --filter @corridas/worker build

FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --filter @corridas/worker --prod && rm -rf /root/.cache /root/.local/share/pnpm
COPY --from=build /repo/worker/dist worker/dist
USER node
WORKDIR /repo/worker
EXPOSE 9464
CMD ["node", "dist/main.js"]
