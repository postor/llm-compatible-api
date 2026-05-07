# llm-compatible-api

[GitHub](https://github.com/postor/llm-compatible-api) | [Legal](#legal)

Bridge one active upstream source into local OpenAI and Anthropic compatible endpoints.

## Usage

```bash
npx llm-compatible-api serve --source openai --base-url https://example.com/v1
```

Startup prints both local targets:

```text
OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1
Anthropic-compatible endpoint ready at http://127.0.0.1:10531
```

## Sources

- `codex`
- `openai`
- `anthropic`

## Local Targets

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses` for `codex` and `openai` sources
- `POST /v1/messages`

## Interactive CLI

```bash
npx llm-compatible-api init
npx llm-compatible-api profiles list
npx llm-compatible-api profiles add --interactive
```

Profiles are stored in `~/.llm-compatible-api/config.json`.

## Headers

Use repeatable `--header key=value` to pass vendor-specific upstream headers.

## Legal

Use only with credentials and upstreams you are authorized to access.
