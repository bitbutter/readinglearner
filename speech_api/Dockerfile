FROM node:24.21.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server.mjs providers.mjs ./
USER node

EXPOSE 8080
CMD ["node", "server.mjs"]
