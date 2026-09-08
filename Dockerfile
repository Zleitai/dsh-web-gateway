FROM node:24.19.0-bookworm-slim AS build
RUN npm install --global pnpm@11.19.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24.19.0-bookworm-slim AS relay
WORKDIR /app
ENV NODE_ENV=production RELAY_BIND=0.0.0.0 RELAY_PORT=4090 RELAY_DATABASE=/data/relay.sqlite
COPY --from=build --chown=node:node /app /app
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4090
CMD ["node", "apps/relay/dist/main.js"]

FROM caddy:2.11.2-alpine AS web
COPY --from=build /app/apps/mobile/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
