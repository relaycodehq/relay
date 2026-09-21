FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY server server
COPY shared shared
COPY scripts/build-rooms.mjs scripts/build-rooms.mjs
RUN node scripts/build-rooms.mjs
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4319 RELAY_ROOMS_DB=/data/rooms.sqlite RELAY_ROOMS_SETUP_KEY_FILE=/run/secrets/setup_key
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=build /src/dist-server/server.mjs ./server.mjs
USER node
EXPOSE 4319
CMD ["node", "server.mjs"]
