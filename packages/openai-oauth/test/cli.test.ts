import { describe, expect, test, vi } from "vitest"
import {
	parseCliArgs,
	toMissingAuthFileMessage,
	toServerOptions,
} from "../src/cli-app.js"
import { toStartupMessage } from "../src/cli-logging.js"

describe("llm-compatible-api cli", () => {
	const withEnv = async (
		values: Record<string, string | undefined>,
		run: () => void | Promise<void>,
	) => {
		const previous = new Map<string, string | undefined>()
		for (const key of Object.keys(values)) {
			previous.set(key, process.env[key])
			const value = values[key]
			if (value === undefined) {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}

		try {
			await run()
		} finally {
			for (const [key, value] of previous) {
				if (value === undefined) {
					delete process.env[key]
				} else {
					process.env[key] = value
				}
			}
		}
	}

	test("runs the post-config hello test for an OpenAI-compatible responses profile", async () => {
		vi.resetModules()
		const profile = {
			name: "openai-compatible-test",
			sourceKind: "openai" as const,
			upstreamApiFormat: "responses" as const,
			baseURL: "https://example.test/v1",
			apiKey: "aaa",
			host: "0.0.0.0",
			port: 10531,
		}
		const collectInitInteractively = vi.fn(async () => ({
			action: "test" as const,
			profile,
		}))
		const saveProfile = vi.fn()
		const resolveProfileStorePath = vi.fn(() => "/tmp/config.json")
		const runtime = {
			sourceKind: "openai",
			upstreamApiFormat: "responses",
			modelFactory: vi.fn(),
			resolveModels: vi.fn(async () => ["gpt-test"]),
			supportsOpenAIResponses: true,
		}
		const createBridgeRuntime = vi.fn(() => runtime)
		const testProfileWithHello = vi.fn(async () => ({
			model: "gpt-test",
			text: "hello back",
		}))

		vi.doMock("../src/interactive.js", () => ({
			collectInitInteractively,
		}))
		vi.doMock("../src/profile-store.js", () => ({
			getStoredProfile: vi.fn(),
			readProfileStore: vi.fn(),
			removeProfile: vi.fn(),
			resolveProfileStorePath,
			saveProfile,
			setDefaultProfile: vi.fn(),
		}))
		vi.doMock("../src/profile-test.js", () => ({
			testProfileWithHello,
		}))
		vi.doMock("../src/runtime.js", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../src/runtime.js")>()
			return {
				...actual,
				createBridgeRuntime,
			}
		})

		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			const { runCli } = await import("../src/cli-app.js")
			await runCli(["init"])

			expect(collectInitInteractively).toHaveBeenCalled()
			expect(saveProfile).toHaveBeenCalledWith(profile, { setDefault: true })
			expect(createBridgeRuntime).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceKind: "openai",
					upstreamApiFormat: "responses",
					apiKey: "aaa",
					host: "0.0.0.0",
					port: 10531,
				}),
			)
			expect(consoleLog).toHaveBeenCalledWith(
				"Testing profile with hello against https://example.test/v1 (responses)...",
			)
			expect(testProfileWithHello).toHaveBeenCalledWith(runtime)
			expect(consoleLog).toHaveBeenCalledWith(
				'Profile test passed with model "gpt-test".',
			)
			expect(consoleLog).toHaveBeenCalledWith("Assistant response: hello back")
		} finally {
			consoleLog.mockRestore()
			vi.doUnmock("../src/interactive.js")
			vi.doUnmock("../src/profile-store.js")
			vi.doUnmock("../src/profile-test.js")
			vi.doUnmock("../src/runtime.js")
		}
	})

	test("skips init profile testing when bypass mode has no saved key", async () => {
		vi.resetModules()
		const profile = {
			name: "bypass-test",
			sourceKind: "openai" as const,
			upstreamApiFormat: "chat" as const,
			baseURL: "https://example.test/v1",
			clientApiKeyMode: "bypass" as const,
			host: "0.0.0.0",
			port: 10531,
		}
		const collectInitInteractively = vi.fn(async () => ({
			action: "test" as const,
			profile,
		}))
		const saveProfile = vi.fn()
		const resolveProfileStorePath = vi.fn(() => "/tmp/config.json")
		const runtime = {
			sourceKind: "openai",
			upstreamApiFormat: "chat",
			modelFactory: vi.fn(),
			resolveModels: vi.fn(async () => ["gpt-test"]),
			supportsOpenAIResponses: false,
			requestChatCompletion: vi.fn(),
		}
		const createBridgeRuntime = vi.fn(() => runtime)
		const testProfileWithHello = vi.fn(async () => ({
			model: "gpt-test",
			text: "hello back",
		}))

		vi.doMock("../src/interactive.js", () => ({
			collectInitInteractively,
		}))
		vi.doMock("../src/profile-store.js", () => ({
			getStoredProfile: vi.fn(),
			readProfileStore: vi.fn(),
			removeProfile: vi.fn(),
			resolveProfileStorePath,
			saveProfile,
			setDefaultProfile: vi.fn(),
		}))
		vi.doMock("../src/profile-test.js", () => ({
			testProfileWithHello,
		}))
		vi.doMock("../src/runtime.js", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../src/runtime.js")>()
			return {
				...actual,
				createBridgeRuntime,
			}
		})

		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {})
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			const { runCli } = await import("../src/cli-app.js")
			await runCli(["init"])

			expect(saveProfile).toHaveBeenCalledWith(profile, { setDefault: true })
			expect(createBridgeRuntime).not.toHaveBeenCalled()
			expect(testProfileWithHello).not.toHaveBeenCalled()
			expect(consoleLog).toHaveBeenCalledWith(
				"Bypass mode has no saved source/client key, so init cannot run the profile test. Start the server and test with a client Authorization bearer key instead.",
			)
			expect(consoleError).not.toHaveBeenCalled()
			expect(profile).toMatchObject({
				clientApiKeyMode: "bypass",
			})
			expect("apiKey" in profile).toBe(false)
		} finally {
			consoleLog.mockRestore()
			consoleError.mockRestore()
			vi.doUnmock("../src/interactive.js")
			vi.doUnmock("../src/profile-store.js")
			vi.doUnmock("../src/profile-test.js")
			vi.doUnmock("../src/runtime.js")
		}
	})

	test("parses kebab-case flags into server options", () => {
		const parsed = parseCliArgs([
			"--host",
			"0.0.0.0",
			"--port",
			"9999",
			"--codex-version",
			"0.114.0",
			"--base-url",
			"https://example.com/codex",
			"--oauth-client-id",
			"client-123",
			"--oauth-token-url",
			"https://auth.example.com/oauth/token",
			"--oauth-file",
			"/tmp/auth.json",
			"--upstream-api-format",
			"chat",
			"--exposed-api-key",
			"sk-local-client-key",
		])

		expect(toServerOptions(parsed)).toMatchObject({
			host: "0.0.0.0",
			port: 9999,
			codexVersion: "0.114.0",
			baseURL: "https://example.com/codex",
			clientId: "client-123",
			tokenUrl: "https://auth.example.com/oauth/token",
			authFilePath: "/tmp/auth.json",
			upstreamApiFormat: "chat",
			exposedApiKey: "sk-local-client-key",
		})
	})

	test("formats the default startup message for local usage", () => {
		expect(
			toStartupMessage("http://127.0.0.1:10531/v1", [
				"gpt-5.4",
				"gpt-5.3-codex",
			]),
		).toBe(
			[
				"OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1",
				"Anthropic-compatible endpoint ready at http://127.0.0.1:10531",
				"Source: openai | No client-side API key is required.",
				"Use the /v1 base URL for OpenAI clients and the root URL for Anthropic clients.",
				"",
				"Available Models: gpt-5.4, gpt-5.3-codex",
			].join("\n"),
		)
	})

	test("formats a missing explicit auth file message", () => {
		expect(toMissingAuthFileMessage("/tmp/missing-auth.json")).toContain(
			"Run `npx @openai/codex login`, or set an API key env var, and try again.",
		)
		expect(toMissingAuthFileMessage("/tmp/missing-auth.json")).toContain(
			"/tmp/missing-auth.json",
		)
	})

	test("does not use hidden environment variable overrides", () => {
		const previousHost = process.env.HOST
		const previousPort = process.env.PORT
		process.env.HOST = "0.0.0.0"
		process.env.PORT = "3333"

		expect(toServerOptions({})).toMatchObject({
			host: undefined,
			port: 10531,
			codexVersion: undefined,
		})

		if (previousHost === undefined) {
			delete process.env.HOST
		} else {
			process.env.HOST = previousHost
		}

		if (previousPort === undefined) {
			delete process.env.PORT
		} else {
			process.env.PORT = previousPort
		}
	})

	test("reads LLM_COMPATIBLE_API environment variables for direct startup", async () => {
		await withEnv(
			{
				LLM_COMPATIBLE_API_SOURCE: "openai",
				LLM_COMPATIBLE_API_BASE_URL: "https://env.example.test/v1",
				LLM_COMPATIBLE_API_API_KEY: "sk-env-key",
				LLM_COMPATIBLE_API_HOST: "0.0.0.0",
				LLM_COMPATIBLE_API_PORT: "12345",
				LLM_COMPATIBLE_API_EXPOSED_API_KEY: "sk-env-client-key",
				LLM_COMPATIBLE_API_UPSTREAM_API_FORMAT: "chat",
				LLM_COMPATIBLE_API_HEADERS: "x-env=yes,x-shared=env",
			},
			() => {
				const parsed = parseCliArgs([])

				expect(toServerOptions(parsed)).toMatchObject({
					sourceKind: "openai",
					baseURL: "https://env.example.test/v1",
					apiKey: "sk-env-key",
					host: "0.0.0.0",
					port: 12345,
					exposedApiKey: "sk-env-client-key",
					upstreamApiFormat: "chat",
					headers: {
						"x-env": "yes",
						"x-shared": "env",
					},
				})
			},
		)
	})

	test("uses source-specific defaults for partial direct-start env", async () => {
		await withEnv(
			{
				LLM_COMPATIBLE_API_SOURCE: "openai",
				LLM_COMPATIBLE_API_BASE_URL: undefined,
				LLM_COMPATIBLE_API_API_KEY: "sk-env-key",
				LLM_COMPATIBLE_API_HOST: "0.0.0.0",
				LLM_COMPATIBLE_API_PORT: "12345",
				LLM_COMPATIBLE_API_UPSTREAM_API_FORMAT: undefined,
			},
			() => {
				expect(toServerOptions(parseCliArgs([]))).toMatchObject({
					sourceKind: "openai",
					baseURL: "https://api.openai.com/v1",
					apiKey: "sk-env-key",
					host: "0.0.0.0",
					port: 12345,
					upstreamApiFormat: "chat",
				})
			},
		)
	})

	test("allows direct startup in bypass client API key mode without a source API key", async () => {
		await withEnv(
			{
				LLM_COMPATIBLE_API_SOURCE: "openai",
				LLM_COMPATIBLE_API_API_KEY: undefined,
				LLM_COMPATIBLE_API_CLIENT_API_KEY_MODE: "bypass",
				LLM_COMPATIBLE_API_BASE_URL: "https://env.example.test/v1",
			},
			() => {
				expect(toServerOptions(parseCliArgs([]))).toMatchObject({
					sourceKind: "openai",
					baseURL: "https://env.example.test/v1",
					apiKey: undefined,
					clientApiKeyMode: "bypass",
					upstreamApiFormat: "chat",
				})
			},
		)
	})

	test("uses the official Anthropic base URL when direct-start env omits base URL", async () => {
		await withEnv(
			{
				LLM_COMPATIBLE_API_SOURCE: "anthropic",
				LLM_COMPATIBLE_API_BASE_URL: undefined,
				LLM_COMPATIBLE_API_API_KEY: "sk-ant-env-key",
			},
			() => {
				expect(toServerOptions(parseCliArgs([]))).toMatchObject({
					sourceKind: "anthropic",
					baseURL: "https://api.anthropic.com/v1",
					apiKey: "sk-ant-env-key",
					upstreamApiFormat: undefined,
				})
			},
		)
	})

	test("ignores env that is not enough to direct-start", async () => {
		await withEnv(
			{
				LLM_COMPATIBLE_API_SOURCE: undefined,
				LLM_COMPATIBLE_API_BASE_URL: "https://env.example.test/v1",
				LLM_COMPATIBLE_API_API_KEY: "sk-env-key",
				LLM_COMPATIBLE_API_HOST: "0.0.0.0",
				LLM_COMPATIBLE_API_PORT: "12345",
			},
			() => {
				expect(toServerOptions(parseCliArgs([]))).toMatchObject({
					sourceKind: undefined,
					baseURL: undefined,
					apiKey: undefined,
					host: undefined,
					port: 10531,
				})
			},
		)
	})

	test("lets CLI flags override LLM_COMPATIBLE_API environment variables", async () => {
		await withEnv(
			{
				LLM_COMPATIBLE_API_SOURCE: "openai",
				LLM_COMPATIBLE_API_BASE_URL: "https://env.example.test/v1",
				LLM_COMPATIBLE_API_API_KEY: "sk-env-key",
				LLM_COMPATIBLE_API_UPSTREAM_API_FORMAT: "responses",
				LLM_COMPATIBLE_API_EXPOSED_API_KEY: "sk-env-client-key",
				LLM_COMPATIBLE_API_HEADERS: "x-shared=env,x-env=yes",
			},
			() => {
				const parsed = parseCliArgs([
					"--source",
					"anthropic",
					"--base-url",
					"https://cli.example.test/v1",
					"--api-key",
					"sk-cli-key",
					"--exposed-api-key",
					"sk-cli-client-key",
					"--upstream-api-format",
					"chat",
					"--header",
					"x-shared=cli",
				])

				expect(toServerOptions(parsed)).toMatchObject({
					sourceKind: "anthropic",
					baseURL: "https://cli.example.test/v1",
					apiKey: "sk-cli-key",
					exposedApiKey: "sk-cli-client-key",
					upstreamApiFormat: "chat",
					headers: {
						"x-env": "yes",
						"x-shared": "cli",
					},
				})
			},
		)
	})
})
