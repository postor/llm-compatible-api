import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createOpenAIOAuthFetchHandler } from "../src/index.js"

const createAuthFile = async (): Promise<string> => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "openai-oauth-server-"))
	const authPath = path.join(root, "auth.json")
	await fs.writeFile(
		authPath,
		JSON.stringify(
			{
				tokens: {
					access_token: "access-token",
					account_id: "acct-1",
				},
			},
			null,
			2,
		),
		"utf-8",
	)
	return authPath
}

describe("openai oauth server", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("lists configured models", async () => {
		const handler = createOpenAIOAuthFetchHandler({
			models: ["gpt-5.2", "gpt-5.1-codex"],
		})

		const response = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			object: "list",
			data: [
				{
					id: "gpt-5.2",
					object: "model",
					created: 0,
					owned_by: "codex",
				},
				{
					id: "gpt-5.1-codex",
					object: "model",
					created: 0,
					owned_by: "codex",
				},
			],
		})
	})

	test("requires the configured client API key for local endpoints", async () => {
		const handler = createOpenAIOAuthFetchHandler({
			exposedApiKey: "sk-local-client-key",
			models: ["gpt-5.2"],
		})

		const missing = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)
		expect(missing.status).toBe(401)
		await expect(missing.json()).resolves.toEqual({
			error: {
				message: "Missing or invalid API key.",
				type: "authentication_error",
			},
		})

		const wrong = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
				headers: {
					Authorization: "Bearer wrong-key",
				},
			}),
		)
		expect(wrong.status).toBe(401)

		const authorized = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
				headers: {
					Authorization: "Bearer sk-local-client-key",
				},
			}),
		)
		expect(authorized.status).toBe(200)
	})

	test("uses the client bearer token as the upstream key in bypass mode", async () => {
		const fetch = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				expect(new Headers(init?.headers).get("authorization")).toBe(
					"Bearer sk-client-upstream-key",
				)
				return new Response(
					JSON.stringify({
						data: [{ id: "gpt-client-key-model" }],
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
						},
					},
				)
			},
		)
		const handler = createOpenAIOAuthFetchHandler({
			sourceKind: "openai",
			upstreamApiFormat: "chat",
			baseURL: "https://example.test/v1",
			clientApiKeyMode: "bypass",
			fetch,
		})

		const missing = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)
		expect(missing.status).toBe(401)
		expect(fetch).not.toHaveBeenCalled()

		const authorized = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
				headers: {
					Authorization: "Bearer sk-client-upstream-key",
				},
			}),
		)

		expect(authorized.status).toBe(200)
		expect(fetch).toHaveBeenCalledTimes(1)
		await expect(authorized.json()).resolves.toEqual({
			object: "list",
			data: [
				{
					id: "gpt-client-key-model",
					object: "model",
					created: 0,
					owned_by: "openai",
				},
			],
		})
	})

	test("passes the client bearer token upstream for chat requests in bypass mode", async () => {
		const fetch = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				expect(String(input)).toBe("https://example.test/v1/chat/completions")
				expect(init?.method).toBe("POST")
				expect(new Headers(init?.headers).get("authorization")).toBe(
					"Bearer sk-client-upstream-key",
				)
				expect(JSON.parse(String(init?.body))).toMatchObject({
					model: "gpt-client-key-model",
					messages: [{ role: "user", content: "hello" }],
				})
				return new Response(
					JSON.stringify({
						id: "chatcmpl_test",
						object: "chat.completion",
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: "hello back" },
								finish_reason: "stop",
							},
						],
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
						},
					},
				)
			},
		)
		const handler = createOpenAIOAuthFetchHandler({
			sourceKind: "openai",
			upstreamApiFormat: "chat",
			baseURL: "https://example.test/v1",
			clientApiKeyMode: "bypass",
			fetch,
		})

		const missing = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-client-key-model",
					messages: [{ role: "user", content: "hello" }],
				}),
			}),
		)
		expect(missing.status).toBe(401)
		expect(fetch).not.toHaveBeenCalled()

		const authorized = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: {
					Authorization: "Bearer sk-client-upstream-key",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-client-key-model",
					messages: [{ role: "user", content: "hello" }],
				}),
			}),
		)

		expect(authorized.status).toBe(200)
		expect(fetch).toHaveBeenCalledTimes(1)
		await expect(authorized.json()).resolves.toMatchObject({
			id: "chatcmpl_test",
			choices: [
				{
					message: {
						content: "hello back",
					},
				},
			],
		})
	})

	test("loads account models from codex when no override is configured", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
			expect(String(input)).toContain(
				"/backend-api/codex/models?client_version=",
			)
			return new Response(
				JSON.stringify({
					models: [
						{ slug: "gpt-5.2" },
						{ slug: "gpt-5.1-codex" },
						{ slug: "gpt-5.2" },
					],
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
					},
				},
			)
		})
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			codexVersion: "0.114.0",
			ensureFresh: false,
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)

		expect(response.status).toBe(200)
		expect(fetch).toHaveBeenCalledTimes(1)
		await expect(response.json()).resolves.toEqual({
			object: "list",
			data: [
				{
					id: "gpt-5.2",
					object: "model",
					created: 0,
					owned_by: "codex",
				},
				{
					id: "gpt-5.1-codex",
					object: "model",
					created: 0,
					owned_by: "codex",
				},
			],
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("returns an upstream error when codex model discovery fails", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						detail: "This account does not support codex model discovery.",
					}),
					{
						status: 403,
						headers: {
							"Content-Type": "application/json",
						},
					},
				),
		)
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			codexVersion: "0.114.0",
			ensureFresh: false,
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)

		expect(response.status).toBe(502)
		await expect(response.json()).resolves.toEqual({
			error: {
				message: "This account does not support codex model discovery.",
				type: "upstream_error",
			},
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("reports the replay state mode in health", async () => {
		const handler = createOpenAIOAuthFetchHandler()
		const health = await handler(
			new Request("http://localhost/health", {
				method: "GET",
			}),
		)

		await expect(health.json()).resolves.toEqual({
			ok: true,
			replay_state: "stateless",
			source: "codex",
			targets: ["openai", "anthropic"],
		})
	})

	test("aggregates streaming responses requests into json when stream is false", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							[
								"event: response.created",
								'data: {"response":{"id":"resp_1","status":"in_progress"}}',
								"",
								"event: response.completed",
								'data: {"response":{"id":"resp_1","status":"completed","output":[{"type":"message"}]}}',
								"",
							].join("\n"),
						),
					)
					controller.close()
				},
			})

			return new Response(stream, { status: 200 })
		})

		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
			instructions: "server-instructions",
		})

		const response = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.2",
					stream: false,
					max_output_tokens: 5,
				}),
			}),
		)

		expect(fetch).toHaveBeenCalledTimes(1)
		const [, init] = fetch.mock.calls[0] ?? []
		expect(JSON.parse(String(init?.body))).toMatchObject({
			model: "gpt-5.2",
			stream: true,
			instructions: "server-instructions",
		})

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			id: "resp_1",
			status: "completed",
			output: [{ type: "message" }],
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("rejects previous_response_id on the stateless responses endpoint", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn()
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.2",
					stream: false,
					previous_response_id: "resp_1",
					input: [],
				}),
			}),
		)

		expect(response.status).toBe(400)
		expect(fetch).not.toHaveBeenCalled()
	})

	test("emits a chat error log when messages is invalid", async () => {
		const requestLogger = vi.fn()
		const handler = createOpenAIOAuthFetchHandler({
			requestLogger,
		})

		const response = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.4",
					messages: "not-an-array",
				}),
			}),
		)

		expect(response.status).toBe(400)
		expect(requestLogger).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "chat_error",
				path: "/v1/chat/completions",
				message: "`messages` must be an array.",
			}),
		)
	})

	test("rejects responses passthrough when the active source is anthropic", async () => {
		const handler = createOpenAIOAuthFetchHandler({
			sourceKind: "anthropic",
			models: ["claude-sonnet-4-6"],
			apiKey: "test-key",
		})

		const response = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "claude-sonnet-4-6",
					input: [],
				}),
			}),
		)

		expect(response.status).toBe(501)
	})

	test("emits an anthropic error when messages is invalid", async () => {
		const requestLogger = vi.fn()
		const handler = createOpenAIOAuthFetchHandler({
			requestLogger,
			sourceKind: "anthropic",
			models: ["claude-sonnet-4-6"],
			apiKey: "test-key",
		})

		const response = await handler(
			new Request("http://localhost/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "claude-sonnet-4-6",
					messages: "not-an-array",
				}),
			}),
		)

		expect(response.status).toBe(400)
		expect(requestLogger).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "anthropic_error",
				path: "/v1/messages",
				message: "`messages` must be an array.",
			}),
		)
	})

	test("returns estimated tokens for Claude Code count_tokens on non-anthropic sources", async () => {
		const handler = createOpenAIOAuthFetchHandler({
			models: ["gpt-5.2"],
		})

		const response = await handler(
			new Request("http://localhost/v1/messages/count_tokens", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.2",
					messages: [{ role: "user", content: "hello" }],
				}),
			}),
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toMatchObject({
			input_tokens: expect.any(Number),
		})
	})

	test("forwards Claude Code count_tokens to anthropic sources with anthropic headers", async () => {
		const fetch = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				expect(String(input)).toBe(
					"https://anthropic.example.test/v1/messages/count_tokens",
				)
				expect(init?.method).toBe("POST")
				const headers = new Headers(init?.headers)
				expect(headers.get("x-api-key")).toBe("test-key")
				expect(headers.get("anthropic-version")).toBe("2023-06-01")
				expect(headers.get("anthropic-beta")).toBe(
					"fine-grained-tool-streaming-2025-05-14",
				)
				expect(JSON.parse(String(init?.body))).toMatchObject({
					model: "claude-sonnet-4-6",
					anthropic_beta: ["fine-grained-tool-streaming-2025-05-14"],
					messages: [{ role: "user", content: "hello" }],
				})

				return new Response(JSON.stringify({ input_tokens: 7 }), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
					},
				})
			},
		)

		const handler = createOpenAIOAuthFetchHandler({
			sourceKind: "anthropic",
			baseURL: "https://anthropic.example.test/v1",
			apiKey: "test-key",
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/messages/count_tokens", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"anthropic-version": "2023-06-01",
					"anthropic-beta": "fine-grained-tool-streaming-2025-05-14",
				},
				body: JSON.stringify({
					model: "claude-sonnet-4-6",
					messages: [{ role: "user", content: "hello" }],
				}),
			}),
		)

		expect(response.status).toBe(200)
		expect(fetch).toHaveBeenCalledTimes(1)
		await expect(response.json()).resolves.toEqual({ input_tokens: 7 })
	})

	test("passes the Claude Code x-api-key upstream in bypass mode", async () => {
		const fetch = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				expect(String(input)).toBe(
					"https://anthropic.example.test/v1/messages/count_tokens",
				)
				expect(new Headers(init?.headers).get("x-api-key")).toBe(
					"sk-client-upstream-key",
				)
				expect(JSON.parse(String(init?.body))).toMatchObject({
					model: "claude-sonnet-4-6",
					messages: [{ role: "user", content: "hello" }],
				})

				return new Response(JSON.stringify({ input_tokens: 9 }), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
					},
				})
			},
		)

		const handler = createOpenAIOAuthFetchHandler({
			sourceKind: "anthropic",
			baseURL: "https://anthropic.example.test/v1",
			clientApiKeyMode: "bypass",
			fetch,
		})

		const missing = await handler(
			new Request("http://localhost/v1/messages/count_tokens", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "claude-sonnet-4-6",
					messages: [{ role: "user", content: "hello" }],
				}),
			}),
		)
		expect(missing.status).toBe(401)
		expect(fetch).not.toHaveBeenCalled()

		const authorized = await handler(
			new Request("http://localhost/v1/messages/count_tokens", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": "sk-client-upstream-key",
				},
				body: JSON.stringify({
					model: "claude-sonnet-4-6",
					messages: [{ role: "user", content: "hello" }],
				}),
			}),
		)

		expect(authorized.status).toBe(200)
		expect(fetch).toHaveBeenCalledTimes(1)
		await expect(authorized.json()).resolves.toEqual({ input_tokens: 9 })
	})
})
