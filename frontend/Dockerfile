# Stage 1: Build the app
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts --legacy-peer-deps || npm ci --ignore-scripts --legacy-peer-deps --fetch-timeout=600000

COPY . .
RUN npm run prepare
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine

WORKDIR /app

# Copy build output and package manifests
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./

# Install production dependencies only
RUN (npm ci --omit=dev --ignore-scripts --legacy-peer-deps || npm ci --omit=dev --ignore-scripts --legacy-peer-deps --fetch-timeout=600000) && npm cache clean --force

RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
    echo "Europe/Berlin" > /etc/timezone

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "build"]
