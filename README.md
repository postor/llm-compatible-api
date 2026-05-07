# llm-compatible-api

[NPM](https://www.npmjs.com/package/llm-compatible-api) | [Legal](#legal)

Bridge one active upstream source into local OpenAI and Anthropic compatible endpoints.

## What It Does

- Accepts one active source per run
- Exposes all local target formats at the same time
- Supports saved profiles with a default profile
- Supports both parameterized CLI usage and interactive setup

## Sources

- `codex`
  ChatGPT/Codex OAuth or `OPENAI_API_KEY` against the default Codex upstream
- `openai`
  Standard OpenAI-compatible `/v1` upstreams
- `anthropic`
  Anthropic Messages API upstreams

## Local Targets

- OpenAI-style
  - `GET /v1/models`
  - `POST /v1/chat/completions`
  - `POST /v1/responses` for `codex` and `openai` sources
- Anthropic-style
  - `POST /v1/messages`

## CLI

Serve directly:

```bash
npx llm-compatible-api serve \
  --source openai \
  --oauth-file ~/.codex/auth.json \
  --base-url https://daobiqian.com/v1
```

Interactive setup:

```bash
npx llm-compatible-api init
```

Profiles:

```bash
npx llm-compatible-api profiles list
npx llm-compatible-api profiles show
npx llm-compatible-api profiles use my-profile
```

If you run `llm-compatible-api` with no arguments:

- it serves the default profile if one exists
- otherwise it opens the interactive setup wizard

## Profile Storage

Profiles are stored in:

```text
~/.llm-compatible-api/config.json
```

You can store multiple upstream configs and switch the default without changing shell aliases or env wiring.

## Extra Headers

Custom upstream headers are supported with repeatable `--header key=value`.

This is useful for:

- third-party compatibility layers
- vendor-specific beta headers
- coding-plan or reasoning-related experimental upstream flags

## Legal

This is an unofficial, community-maintained project and is not affiliated with, endorsed by, or sponsored by OpenAI or Anthropic.

Use only on trusted machines and only with credentials you are authorized to use.
