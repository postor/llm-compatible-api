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
  ChatGPT/Codex OAuth against the official Codex upstream
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
  --api-key sk-your-key \
  --exposed-api-key sk-client-key
```

Interactive setup:

```bash
npx llm-compatible-api init
```

The wizard shows an upstream provider menu instead of asking for a raw URL:

- `official` uses the ChatGPT/Codex upstream and requires local Codex OAuth
- `unofficial` uses the built-in third-party OpenAI-compatible upstream preset and a pasted API key
- `anthropic` uses the Anthropic Messages API upstream

For third-party OpenAI-compatible upstreams, the wizard also asks whether the
upstream expects the Responses API or Chat Completions format.

For API-key upstreams, the interactive wizard asks for the key directly. Env
vars are still supported for direct `serve` usage and `.env`-driven startup.
The wizard also asks for the source API key mode:

- Use a separate local client API key.
- Bypass the local client Bearer key to the upstream as the source key.
- Allow local requests without a client key.

When a client key is configured or bypass mode is enabled, requests to the local
endpoints must send `Authorization: Bearer <key>`. Claude Code style
`x-api-key: <key>` requests are also accepted.

After saving, the wizard shows a final action menu. `Test profile` sends a
`hello` message and checks whether the upstream returns a response; `End setup`
finishes without testing. In bypass mode, the profile has no saved source or
client key, so init cannot run the profile test. Start the server and test with
a client `Authorization: Bearer <key>` request instead.

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

Supported direct-start env vars:

- `LLM_COMPATIBLE_API_SOURCE`
- `LLM_COMPATIBLE_API_BASE_URL`
- `LLM_COMPATIBLE_API_API_KEY`
- `LLM_COMPATIBLE_API_UPSTREAM_API_FORMAT`
- `LLM_COMPATIBLE_API_HOST`
- `LLM_COMPATIBLE_API_PORT`
- `LLM_COMPATIBLE_API_EXPOSED_API_KEY`
- `LLM_COMPATIBLE_API_CLIENT_API_KEY_MODE`
- `LLM_COMPATIBLE_API_HEADERS`

Direct-start env is used when `LLM_COMPATIBLE_API_SOURCE` and
`LLM_COMPATIBLE_API_API_KEY` are set. `LLM_COMPATIBLE_API_BASE_URL` is optional:
`openai` defaults to `https://api.openai.com/v1`, and `anthropic` defaults to
`https://api.anthropic.com/v1`. OpenAI-compatible direct-start env defaults to
Chat Completions format unless `LLM_COMPATIBLE_API_UPSTREAM_API_FORMAT` is set.
Set `LLM_COMPATIBLE_API_EXPOSED_API_KEY` to require a Bearer key from local
proxy clients. Set `LLM_COMPATIBLE_API_CLIENT_API_KEY_MODE=bypass` to use each
client request's Bearer key or `x-api-key` value as the upstream source API key.
Otherwise, env is ignored and the saved interactive profile can be used. CLI
flags override env vars.

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
  -e LLM_COMPATIBLE_API_API_KEY=sk-your-key \
  -e LLM_COMPATIBLE_API_HOST=0.0.0.0 \
  postor/llm-compatible-api:latest
```

This starts:

- OpenAI target at `http://127.0.0.1:10531/v1`
- Anthropic target at `http://127.0.0.1:10531`

## Docker Compose

The included Compose file uses the published Docker Hub image and persists
state in the expected home-directory locations:

- saved bridge profiles are stored in the `llm-compatible-api-data` volume at `/root/.llm-compatible-api`
- host `~/.codex` is mounted to `/root/.codex`
- host `~/.claude` is mounted to `/root/.claude`

Compose uses `${HOME}/.codex` and `${HOME}/.claude` by default, falling back to
`${USERPROFILE}` on Windows. Override `LLM_COMPATIBLE_API_CODEX_DIR` or
`LLM_COMPATIBLE_API_CLAUDE_DIR` in `.env` only if your config directories live
somewhere else.

Interactive setup:

```bash
docker compose build
docker compose run --rm llm-compatible-api init
```

When the wizard asks for `Bind host`, use `0.0.0.0` inside Docker so the
published port is reachable from the host machine. The profile is saved at
`/root/.llm-compatible-api/config.json` in the Compose volume. Official Codex
profiles can use `/root/.codex/auth.json`, which maps to your host
`~/.codex/auth.json` by default.

If you serve without a saved interactive profile, put the direct-start
configuration in `.env` before starting the service:

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
and setting `LLM_COMPATIBLE_API_SOURCE`, `LLM_COMPATIBLE_API_API_KEY`, and
optionally `LLM_COMPATIBLE_API_BASE_URL` and
`LLM_COMPATIBLE_API_UPSTREAM_API_FORMAT`. When the required direct-start
variables are set, they are used instead of opening or loading an interactive
profile.

## Extra Headers

Custom upstream headers are supported with repeatable `--header key=value`.

This is useful for:

- third-party compatibility layers
- vendor-specific beta headers
- coding-plan or reasoning-related experimental upstream flags

## Legal

This is an unofficial, community-maintained project and is not affiliated with, endorsed by, or sponsored by OpenAI or Anthropic.

Use only on trusted machines and only with credentials you are authorized to use.
