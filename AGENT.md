# AGENT

## Goal

Run `llm-compatible-api` locally with one active source per run, while exposing all local target formats:

- OpenAI target: `/v1/chat/completions`, `/v1/responses`, `/v1/models`
- Anthropic target: `/v1/messages`

## Current Behavior

- Supported sources: `codex`, `openai`, `anthropic`
- Only one source is active per process
- Profiles are stored in `~/.llm-compatible-api/config.json`
- Default profile is used when the CLI is run without arguments

## Do This

Build:

```bash
bun run build
```

Serve a standard OpenAI-compatible upstream:

```bash
node packages/openai-oauth/dist/cli.js \
  serve \
  --source openai \
  --oauth-file ~/.codex/auth.json \
  --base-url https://daobiqian.com/v1 \
  --port 10531
```

Interactive setup:

```bash
node packages/openai-oauth/dist/cli.js init
```

Profiles:

```bash
node packages/openai-oauth/dist/cli.js profiles list
node packages/openai-oauth/dist/cli.js profiles show
node packages/openai-oauth/dist/cli.js profiles use <name>
```

Use:

- OpenAI base URL: `http://127.0.0.1:10531/v1`
- Anthropic base URL: `http://127.0.0.1:10531`
- Local proxy does not require a client-side API key

## Rules

- Do not assume `npx llm-compatible-api` includes local patches
- Use local build output for verification
- `/v1/responses` is only supported for `codex` and `openai` sources
- Use repeatable `--header key=value` for vendor-specific upstream flags
- Prefer profiles for long-lived source configs

## Verify

```bash
curl -s http://127.0.0.1:10531/health | jq
curl -s http://127.0.0.1:10531/v1/models | jq '.data | length'
```
