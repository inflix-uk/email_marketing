# Inflix Marketing: web app (port 3000) + background sending worker in one container.
FROM node:22-alpine

WORKDIR /app

# mongodb-memory-server is a dev/test helper only: skip its mongod binary download.
ENV MONGOMS_DISABLE_POSTINSTALL=1 \
    NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# data/config.json (MongoDB connection saved by /setup) and backups live here.
# Mount a volume on /app/data, or set MONGODB_URI instead.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

# `npm start` runs `next start` and the worker (tsx) side by side.
CMD ["npm", "start"]
