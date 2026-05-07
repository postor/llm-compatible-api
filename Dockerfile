FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/openai-oauth/package.json ./packages/openai-oauth/package.json
COPY packages/openai-oauth-core/package.json ./packages/openai-oauth-core/package.json
COPY packages/openai-oauth-provider/package.json ./packages/openai-oauth-provider/package.json
RUN pnpm install --frozen-lockfile --prod --filter llm-compatible-api

FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/openai-oauth/dist ./packages/openai-oauth/dist

EXPOSE 10531

CMD ["node", "/app/packages/openai-oauth/dist/cli.js", "serve"]
