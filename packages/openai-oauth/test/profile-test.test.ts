import { describe, expect, test, vi } from "vitest"
import type { BridgeRuntime } from "../src/types.js"

describe("profile test probe", () => {
	test("sends hello with a resolved model and returns text", async () => {
		const generateText = vi.fn(async () => ({ text: "hello back" }))
		vi.resetModules()
		vi.doMock("ai", () => ({
			generateText,
		}))

		const { testProfileWithHello } = await import("../src/profile-test.js")
		const model = { id: "model" }
		const runtime: BridgeRuntime = {
			sourceKind: "openai",
			defaultModel: "fallback-model",
			modelFactory: vi.fn(() => model as never),
			resolveModels: vi.fn(async () => ["gpt-test"]),
			supportsOpenAIResponses: true,
		}

		const result = await testProfileWithHello(runtime)

		expect(runtime.resolveModels).toHaveBeenCalled()
		expect(runtime.modelFactory).toHaveBeenCalledWith("gpt-test")
		expect(generateText).toHaveBeenCalledWith({
			model,
			messages: [{ role: "user", content: "hello" }],
			maxOutputTokens: 64,
			maxRetries: 0,
		})
		expect(result).toEqual({
			model: "gpt-test",
			text: "hello back",
		})
		vi.doUnmock("ai")
	})

	test("falls back to the runtime default model when model discovery is empty", async () => {
		const generateText = vi.fn(async () => ({ text: "default hello" }))
		vi.resetModules()
		vi.doMock("ai", () => ({
			generateText,
		}))

		const { testProfileWithHello } = await import("../src/profile-test.js")
		const model = { id: "default" }
		const runtime: BridgeRuntime = {
			sourceKind: "codex",
			defaultModel: "fallback-model",
			modelFactory: vi.fn(() => model as never),
			resolveModels: vi.fn(async () => []),
			supportsOpenAIResponses: true,
		}

		const result = await testProfileWithHello(runtime)

		expect(runtime.modelFactory).toHaveBeenCalledWith("fallback-model")
		expect(result).toEqual({
			model: "fallback-model",
			text: "default hello",
		})
		vi.doUnmock("ai")
	})

	test("prefers an explicitly requested model over the first discovered model", async () => {
		const generateText = vi.fn(async () => ({ text: "preferred hello" }))
		vi.resetModules()
		vi.doMock("ai", () => ({
			generateText,
		}))

		const { testProfileWithHello } = await import("../src/profile-test.js")
		const model = { id: "preferred" }
		const runtime: BridgeRuntime = {
			sourceKind: "openai",
			defaultModel: "gpt-5.5",
			modelFactory: vi.fn(() => model as never),
			resolveModels: vi.fn(async () => [
				"claude-3-5-haiku-20241022",
				"gpt-5.5",
			]),
			supportsOpenAIResponses: true,
		}

		const result = await testProfileWithHello(runtime, "gpt-5.5")

		expect(runtime.modelFactory).toHaveBeenCalledWith("gpt-5.5")
		expect(result).toEqual({
			model: "gpt-5.5",
			text: "preferred hello",
		})
		vi.doUnmock("ai")
	})

	test("sends hello through chat completions when the runtime uses chat format", async () => {
		const generateText = vi.fn()
		vi.resetModules()
		vi.doMock("ai", () => ({
			generateText,
		}))

		const { testProfileWithHello } = await import("../src/profile-test.js")
		const requestChatCompletion = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: "chat hello",
								},
							},
						],
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
						},
					},
				),
		)
		const runtime: BridgeRuntime = {
			sourceKind: "openai",
			upstreamApiFormat: "chat",
			defaultModel: "fallback-model",
			modelFactory: vi.fn(),
			resolveModels: vi.fn(async () => ["gpt-chat"]),
			supportsOpenAIResponses: false,
			requestChatCompletion,
		}

		const result = await testProfileWithHello(runtime)

		expect(generateText).not.toHaveBeenCalled()
		expect(requestChatCompletion).toHaveBeenCalledWith({
			model: "gpt-chat",
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 64,
		})
		expect(result).toEqual({
			model: "gpt-chat",
			text: "chat hello",
		})
		vi.doUnmock("ai")
	})
})
