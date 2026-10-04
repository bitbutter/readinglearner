FROM node:24.21.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg=7:5.1.9-0+deb12u1 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server.mjs providers.mjs audio_preprocessing.mjs ./
USER node

EXPOSE 8080
CMD ["node", "server.mjs"]
