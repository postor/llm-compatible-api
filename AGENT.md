# AGENT

## Work Style

- 少废话，多干活。能直接改就直接改。
- 只有高风险或需求不明确时才问问题。
- 每次改完都跑能跑的测试/检查，再汇报结果。
- 汇报只说关键改动、验证结果、阻塞原因。
- 开发时按“先验证现状 -> 写回归 -> 改代码 -> 再验证”的节奏走。
- Debug / 排查问题时，先想办法 narrow down：先缩小范围，确认具体是哪个环节、哪一层、哪个输入或哪个条件触发了问题，再继续往下查；不要像无头苍蝇一样同时乱试多个方向。
- 发现重复、命名混乱、流程割裂时，顺手做小步重构；不要为了“纯加功能”堆债。
- 不做大爆炸重构。每次重构都要有用户体验或维护性收益，并能被测试覆盖。
- 命令和文档优先使用当前源码路径，别让开发命令误跑旧 dist。

## Product Direction

- 用户体验优先于内部实现方便。
- 交互式配置尽量用选择器、默认值和可回车确认，少让用户记单词或手填枚举。
- 所有长耗时动作都要有“进行中”提示，尤其是网络测试、模型拉取、启动服务。
- 错误信息要告诉用户下一步能做什么；不要只抛底层异常。
- 默认值使用官方、最常见、最安全的路径：OpenAI 默认 `https://api.openai.com/v1`，Anthropic 默认 `https://api.anthropic.com/v1`。
- 支持高级用户覆盖默认值，但不要把覆盖路径变成普通用户的必填项。

## Project

- One active source per process: `codex`, `openai`, or `anthropic`.
- Local targets: `/v1/chat/completions`, `/v1/responses`, `/v1/models`, `/v1/messages`.
- Profiles live at `~/.llm-compatible-api/config.json`.
- No args: serve default profile, or open setup if none exists.

## Commands

```bash
pnpm install
pnpm run dev init
pnpm run dev profiles list
pnpm run dev profiles show
pnpm run dev profiles use <name>
pnpm run build
pnpm run typecheck
pnpm run test
```

OpenAI-compatible serve:

```bash
pnpm run dev serve --source openai --api-key-env OPENAI_API_KEY --port 10531
```

## Behavior

- Setup uses menus, not free-form source/format/action input.
- Official Codex uses Codex auth.
- Third-party OpenAI-compatible asks Responses vs Chat, base URL with official OpenAI default, then direct API key.
- Existing API key can be reused or replaced.
- Env vars are for direct `serve` / `.env`, not interactive setup.
- Direct-start env needs source + API key; base URL defaults to official OpenAI/Anthropic.
- OpenAI-compatible format defaults to Chat Completions.
- Init asks whether local proxy clients should use a separate client API key, bypass the client key to the upstream, or skip local client auth.
- After setup, always offer Test profile / End setup; do not remember or auto-skip this choice.
- Profile test sends a `hello` request and prints an in-progress message before the network call.
- Profile test must send `hello` once only; do not use SDK retries for this probe.
- Bypass mode has no saved source key or fixed client key, so init must not run the profile test; tell the user to start the server and test with a client Bearer key instead.

## Rules

- Use local build output; do not assume `npx llm-compatible-api` has local patches.
- `/v1/responses` is only for `codex` and `openai`.
- Use repeatable `--header key=value` for vendor headers.
- Prefer profiles for long-lived configs.
- Local proxy requires a client-side API key when `exposedApiKey`, `LLM_COMPATIBLE_API_EXPOSED_API_KEY`, or bypass mode is configured.
- Keep package management on pnpm. Do not reintroduce npm lockfiles, bun lockfiles, or bun scripts.
- Docker/compose should mount normal home config dirs (`~/.codex`, `~/.claude`) instead of surprise project volumes.
- `auth.json` is only required for Codex auth flows; OpenAI-compatible API-key flows must not fail with Codex login/auth.json errors.

## Refactor While Developing

- When adding a feature, simplify nearby code if it reduces future bugs.
- Keep shared defaults in one place and import them instead of duplicating URLs.
- Prefer small extracted helpers over long interactive flows with hidden state.
- Test real user paths, not only mocked internals; for CLI work, include at least one stdin/command simulation when relevant.
- If a test passes but the real command fails, treat the test as incomplete and improve it.
- Do not hide behavior behind env during interactive setup; env is for direct startup.

## Verify

```bash
pnpm run typecheck
pnpm run test
curl -s http://127.0.0.1:10531/health | jq
curl -s http://127.0.0.1:10531/v1/models | jq '.data | length'
```
