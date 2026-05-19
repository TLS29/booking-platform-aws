FROM node:20-alpine AS deps
  WORKDIR /app
  RUN corepack enable
  COPY package.json pnpm-lock.yaml ./
  RUN pnpm install --frozen-lockfile
FROM deps AS builder
  COPY . .
  RUN pnpm build
FROM deps AS dev
  COPY . .
  EXPOSE 3000
  CMD ["pnpm", "dev:docker"]
FROM node:20-alpine AS runtime
  WORKDIR /app
  RUN corepack enable                                                                                                                                           
  ENV NODE_ENV=production
  COPY package.json pnpm-lock.yaml ./
  RUN pnpm install --frozen-lockfile --prod
  COPY --from=builder /app/dist ./dist
  USER node                                                                                                                                                     
  EXPOSE 3000
  CMD ["node", "dist/main.js"]