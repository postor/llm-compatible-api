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
  --base-url https://your-upstream.example.com/v1 \
  --api-key sk-your-key
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

## Environment Variables

Supported serve-time env vars:

- `LLM_COMPATIBLE_API_SOURCE`
- `LLM_COMPATIBLE_API_BASE_URL`
- `LLM_COMPATIBLE_API_API_KEY`
- `LLM_COMPATIBLE_API_HOST`
- `LLM_COMPATIBLE_API_PORT`
- `LLM_COMPATIBLE_API_MODELS`
- `LLM_COMPATIBLE_API_DEFAULT_MODEL`
- `LLM_COMPATIBLE_API_HEADERS`

CLI flags override env vars. Env vars override saved profile values.

## Docker Hub Image

The published Docker image is:

```bash
docker pull postor/llm-compatible-api:latest
```

Run it directly:

```bash
docker run --rm \
  -p 10531:10531 \
  -e LLM_COMPATIBLE_API_SOURCE=openai \
  -e LLM_COMPATIBLE_API_BASE_URL=https://your-upstream.example.com/v1 \
  -e LLM_COMPATIBLE_API_API_KEY=sk-your-key \
  -e LLM_COMPATIBLE_API_HOST=0.0.0.0 \
  postor/llm-compatible-api:latest
```

This starts:

- OpenAI target at `http://127.0.0.1:10531/v1`
- Anthropic target at `http://127.0.0.1:10531`

## Docker Compose

The included Compose file uses the published Docker Hub image and stores CLI
profiles in the `llm-compatible-api-data` Docker volume.

Interactive setup:

```bash
docker compose build
docker compose run --rm llm-compatible-api init
```

When the wizard asks for `Bind host`, use `0.0.0.0` inside Docker so the
published port is reachable from the host machine. The profile is saved at
`/root/.llm-compatible-api/config.json` in the Compose volume.

If the wizard stores an API key environment variable such as `OPENAI_API_KEY`
or `ANTHROPIC_API_KEY`, put that variable in `.env` before starting the service:

```bash
cp .env.example .env
# edit .env
```

Start the service in the background:

```bash
docker compose up -d
```

This loads the saved default profile and starts:

- OpenAI target at `http://127.0.0.1:10531/v1`
- Anthropic target at `http://127.0.0.1:10531`

Check status and logs:

```bash
docker compose ps
docker compose logs -f llm-compatible-api
```

Stop the background service:

```bash
docker compose down
```

You can also serve without a saved profile by copying `.env.example` to `.env`
and setting `LLM_COMPATIBLE_API_SOURCE`, `LLM_COMPATIBLE_API_BASE_URL`, and
`LLM_COMPATIBLE_API_API_KEY`. Environment variables override saved profile
values.

## Extra Headers

Custom upstream headers are supported with repeatable `--header key=value`.

This is useful for:

- third-party compatibility layers
- vendor-specific beta headers
- coding-plan or reasoning-related experimental upstream flags

## Legal

This is an unofficial, community-maintained project and is not affiliated with, endorsed by, or sponsored by OpenAI or Anthropic.

Use only on trusted machines and only with credentials you are authorized to use.
