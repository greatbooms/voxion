FROM node:24-alpine AS base

RUN apk add --no-cache ffmpeg

WORKDIR /app

FROM base AS builder

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV STORAGE_ROOT=/app/storage

COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

RUN mkdir -p /app/storage

EXPOSE 3000

CMD ["node", "dist/main"]
