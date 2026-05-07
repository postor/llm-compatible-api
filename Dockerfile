FROM oven/bun:1.2.18 AS builder

WORKDIR /app

COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.2.18 AS deps

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/openai-oauth/package.json ./packages/openai-oauth/package.json
COPY packages/openai-oauth-core/package.json ./packages/openai-oauth-core/package.json
COPY packages/openai-oauth-provider/package.json ./packages/openai-oauth-provider/package.json
RUN bun install --frozen-lockfile --production --filter llm-compatible-api

FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/openai-oauth/dist ./packages/openai-oauth/dist

EXPOSE 10531

CMD ["node", "/app/packages/openai-oauth/dist/cli.js", "serve"]
