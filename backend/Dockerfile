FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM alpine:3.21

ARG PB_VERSION=0.39.8

RUN apk add --no-cache \
    unzip \
    ca-certificates \
    tzdata \
    wget && \
    cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
    echo "Europe/Berlin" > /etc/timezone

ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/ && rm /tmp/pb.zip

COPY --from=builder /app/pb_migrations /pb/pb_migrations
COPY --from=builder /app/pb_hooks /pb/pb_hooks

EXPOSE 8090

CMD ["sh", "-c", "/pb/pocketbase migrate up && exec /pb/pocketbase serve --http=0.0.0.0:8090"]
