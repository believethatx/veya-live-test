FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/public ./public
COPY --from=build /app/*.mjs ./
RUN mkdir -p /data && chown node:node /data
ENV DATA_FILE=/data/veya.sqlite
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
