FROM node:24.22.2-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY ui/package.json ui/
RUN pnpm install --frozen-lockfile --filter @corridas/ui
COPY ui/ ui/
RUN pnpm --filter @corridas/ui build

FROM nginxinc/nginx-unprivileged:1.30.6-alpine
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/ui/dist /usr/share/nginx/html
EXPOSE 8080
