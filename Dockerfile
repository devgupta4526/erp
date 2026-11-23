FROM node:24-bookworm-slim AS dependencies
WORKDIR /srv/businessos
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /srv/businessos
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /srv/businessos/package.json ./
COPY --from=build --chown=node:node /srv/businessos/node_modules ./node_modules
COPY --from=build --chown=node:node /srv/businessos/apps ./apps
COPY --from=build --chown=node:node /srv/businessos/scripts ./scripts
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0"]
