import { describe, expect, test, vi } from "vitest"

const withMockedTtyKeys = async <T>(
	keys: Array<{ delayMs?: number; name?: string; sequence?: string }>,
	run: () => Promise<T>,
) => {
	vi.resetModules()
	const listeners = new Map<string, (...args: unknown[]) => void>()
	const writes: string[] = []
	const events: string[] = []
	const clearScreenDown = vi.fn(() => {
		events.push("clear")
	})
	const moveCursor = vi.fn(() => {
		events.push("move")
	})
	const close = vi.fn()
	let rawMode = false

	vi.doMock("node:process", () => ({
		stdin: {
			isTTY: true,
			setRawMode: vi.fn((value: boolean) => {
				rawMode = value
			}),
			on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
				listeners.set(event, listener)
			}),
			off: vi.fn((event: string) => {
				listeners.delete(event)
			}),
		},
		stdout: {
			isTTY: true,
			write: vi.fn((value: string) => {
				writes.push(value)
				events.push(`write:${value}`)
				return true
			}),
		},
	}))
	vi.doMock("node:readline", () => ({
		default: {
			emitKeypressEvents: vi.fn(),
			clearScreenDown,
			moveCursor,
		},
		emitKeypressEvents: vi.fn(),
		clearScreenDown,
		moveCursor,
	}))
	vi.doMock("node:readline/promises", () => ({
		createInterface: () => ({
			close,
		}),
	}))

	const promise = run()
	await vi.waitFor(() => {
		expect(listeners.has("keypress")).toBe(true)
	})
	const listener = listeners.get("keypress")
	if (!listener) {
		throw new Error("keypress listener was not registered")
	}
	for (const key of keys) {
		if (typeof key.delayMs === "number") {
			await vi.advanceTimersByTimeAsync(key.delayMs)
		}
		listener("", key)
		await Promise.resolve()
	}
	const result = await promise

	vi.doUnmock("node:process")
	vi.doUnmock("node:readline")
	vi.doUnmock("node:readline/promises")

	return {
		result,
		writes: writes.join(""),
		close,
		rawMode,
		clearScreenDown,
		moveCursor,
		events,
	}
}

const withMockedQuestions = async <T>(
	answers: string[],
	run: () => Promise<T>,
) => {
	vi.resetModules()
	const prompts: string[] = []
	const close = vi.fn()
	const lineListeners: Array<(line: string) => void> = []
	const closeListeners: Array<() => void> = []
	let scheduled = false

	const scheduleInput = () => {
		if (scheduled) {
			return
		}
		scheduled = true
		queueMicrotask(() => {
			for (const answer of answers) {
				for (const listener of lineListeners) {
					listener(answer)
				}
			}
			for (const listener of closeListeners) {
				listener()
			}
		})
	}

	vi.doMock("node:process", () => ({
		stdin: {
			isTTY: false,
		},
		stdout: {
			isTTY: false,
			write: vi.fn((prompt: string) => {
				prompts.push(prompt)
				return true
			}),
		},
	}))

	vi.doMock("node:readline", () => {
		const mockedReadline = {
			createInterface: vi.fn(() => ({
				close,
				on: vi.fn((event: string, listener: (value?: string) => void) => {
					if (event === "line") {
						lineListeners.push(listener as (line: string) => void)
						scheduleInput()
					}
					if (event === "close") {
						closeListeners.push(listener as () => void)
						scheduleInput()
					}
				}),
			})),
		}

		return {
			default: mockedReadline,
			...mockedReadline,
		}
	})

	vi.doMock("node:readline/promises", () => ({
		createInterface: () => ({
			close,
			question: vi.fn(),
		}),
	}))

	const result = await run()
	vi.doUnmock("node:process")
	vi.doUnmock("node:readline")
	vi.doUnmock("node:readline/promises")

	return { close, result, prompts: prompts.join("") }
}

const collectWithAnswers = async (
	answers: string[],
	existing?: Parameters<
		typeof import("../src/interactive.js").collectProfileInteractively
	>[0],
) => {
	return withMockedQuestions(answers, async () => {
		const { collectProfileInteractively } = await import(
			"../src/interactive.js"
		)
		return collectProfileInteractively(existing)
	})
}

describe("interactive profile setup", () => {
	test("uses the official Codex upstream without asking for a URL", async () => {
		const { result: profile, prompts } = await collectWithAnswers([
			"official-profile",
			"1",
			"",
			"",
			"",
			"",
			"",
			"",
		])

		expect(profile).toMatchObject({
			name: "official-profile",
			sourceKind: "codex",
			baseURL: "https://chatgpt.com/backend-api/codex",
			authFilePath: "~/.codex/auth.json",
			port: 10531,
		})
		expect(profile.apiKeyEnvVar).toBeUndefined()
		expect(profile.apiKey).toBeUndefined()
		expect(profile.exposedApiKey).toBeUndefined()
		expect(prompts).toContain("Upstream provider")
		expect(prompts).toContain("1. Official Codex")
		expect(prompts).toContain("2. Third-party OpenAI-compatible")
		expect(prompts).not.toContain("API key source")
		expect(prompts).toContain(
			"Client API key (blank to allow local requests without a key)",
		)
		expect(prompts).not.toContain("API key env var")
		expect(prompts).not.toContain("(official/unofficial/anthropic)")
		expect(prompts).not.toContain("Upstream base URL")
	})

	test("uses the default OpenAI-compatible upstream when base URL is blank", async () => {
		const { result: profile, prompts } = await collectWithAnswers([
			"third-party-profile",
			"2",
			"2",
			"",
			"1",
			"sk-test-key",
			"sk-local-client-key",
			"",
			"",
			"",
		])

		expect(profile).toMatchObject({
			name: "third-party-profile",
			sourceKind: "openai",
			upstreamApiFormat: "chat",
			baseURL: "https://api.openai.com/v1",
			apiKey: "sk-test-key",
			exposedApiKey: "sk-local-client-key",
			port: 10531,
		})
		expect(profile.authFilePath).toBeUndefined()
		expect(profile.apiKeyEnvVar).toBeUndefined()
		expect(prompts).toContain("Upstream provider")
		expect(prompts).toContain("1. Official Codex")
		expect(prompts).toContain("2. Third-party OpenAI-compatible")
		expect(prompts).toContain("OpenAI-compatible API format")
		expect(prompts).toContain("1. Responses API")
		expect(prompts).toContain("2. Chat Completions (default)")
		expect(prompts).toContain("Upstream base URL")
		expect(prompts).toContain("API key")
		expect(prompts).toContain("Source API key mode")
		expect(prompts).toContain("1. Use separate client API key")
		expect(prompts).toContain("2. Bypass client API key to upstream")
		expect(prompts).not.toContain("Use upstream API key for clients")
		expect(prompts).not.toContain("API key source")
		expect(prompts).not.toContain("API key env var")
		expect(prompts).not.toContain("(official/unofficial/anthropic)")
	})

	test("collects a separate client API key for the local proxy", async () => {
		const { result: profile, prompts } = await collectWithAnswers([
			"custom-client-key-profile",
			"2",
			"2",
			"",
			"1",
			"sk-upstream-key",
			"sk-local-client-key",
			"",
			"",
		])

		expect(profile).toMatchObject({
			name: "custom-client-key-profile",
			sourceKind: "openai",
			upstreamApiFormat: "chat",
			apiKey: "sk-upstream-key",
			exposedApiKey: "sk-local-client-key",
			port: 10531,
		})
		expect(prompts).toContain("Source API key mode")
		expect(prompts).toContain("New client API key")
		expect(prompts).not.toContain("sk-upstream-key")
	})

	test("collects bypass key mode for the local proxy", async () => {
		const { result: profile, prompts } = await collectWithAnswers([
			"bypass-client-key-profile",
			"2",
			"2",
			"",
			"2",
			"",
			"",
			"",
		])

		expect(profile).toMatchObject({
			name: "bypass-client-key-profile",
			sourceKind: "openai",
			upstreamApiFormat: "chat",
			clientApiKeyMode: "bypass",
			port: 10531,
		})
		expect(profile.apiKey).toBeUndefined()
		expect(profile.exposedApiKey).toBeUndefined()
		expect(prompts).toContain("Source API key mode")
		expect(prompts).toContain("2. Bypass client API key to upstream")
		expect(prompts).not.toContain("API key: ")
	})

	test("collects a custom OpenAI-compatible base URL", async () => {
		const { result: profile, prompts } = await collectWithAnswers([
			"custom-openai-profile",
			"2",
			"1",
			"https://third.example.test/v1",
			"1",
			"aaa",
			"sk-local-client-key",
			"0.0.0.0",
			"",
			"",
		])

		expect(profile).toMatchObject({
			name: "custom-openai-profile",
			sourceKind: "openai",
			upstreamApiFormat: "responses",
			baseURL: "https://third.example.test/v1",
			apiKey: "aaa",
			exposedApiKey: "sk-local-client-key",
			host: "0.0.0.0",
			port: 10531,
		})
		expect(prompts).toContain("Upstream base URL")
	})

	test("collects the OpenAI-compatible responses setup path with default port", async () => {
		const { result: profile, prompts } = await collectWithAnswers([
			"responses-profile",
			"2",
			"1",
			"",
			"1",
			"aaa",
			"sk-local-client-key",
			"0.0.0.0",
			"",
			"",
		])

		expect(profile).toMatchObject({
			name: "responses-profile",
			sourceKind: "openai",
			upstreamApiFormat: "responses",
			baseURL: "https://api.openai.com/v1",
			apiKey: "aaa",
			exposedApiKey: "sk-local-client-key",
			host: "0.0.0.0",
			port: 10531,
		})
		expect(profile.authFilePath).toBeUndefined()
		expect(profile.apiKeyEnvVar).toBeUndefined()
		expect(prompts).toContain("OpenAI-compatible API format")
		expect(prompts).toContain("1. Responses API")
		expect(prompts).toContain("Bind host")
		expect(prompts).toContain("Bind port")
		expect(prompts).not.toContain("API key env var")
	})

	test("collects init profile and test action in one readline session", async () => {
		const { close, result, prompts } = await withMockedQuestions(
			[
				"responses-profile",
				"2",
				"1",
				"",
				"1",
				"aaa",
				"sk-local-client-key",
				"0.0.0.0",
				"",
				"",
				"1",
			],
			async () => {
				const { collectInitInteractively } = await import(
					"../src/interactive.js"
				)
				return collectInitInteractively()
			},
		)

		expect(result).toMatchObject({
			action: "test",
			profile: {
				name: "responses-profile",
				sourceKind: "openai",
				upstreamApiFormat: "responses",
				baseURL: "https://api.openai.com/v1",
				apiKey: "aaa",
				exposedApiKey: "sk-local-client-key",
				host: "0.0.0.0",
				port: 10531,
			},
		})
		expect(result.profile.authFilePath).toBeUndefined()
		expect(result.profile.apiKeyEnvVar).toBeUndefined()
		expect(prompts).toContain("OpenAI-compatible API format")
		expect(prompts).toContain("Next action")
		expect(prompts).toContain("1. Test profile")
		expect(prompts).toContain("2. End setup")
		expect(close).toHaveBeenCalledTimes(1)
	})

	test("keeps the existing API key when selected", async () => {
		const { result: profile, prompts } = await collectWithAnswers(
			[
				"third-party-profile",
				"2",
				"2",
				"",
				"1",
				"1",
				"sk-local-client-key",
				"",
				"",
			],
			{
				sourceKind: "openai",
				upstreamApiFormat: "chat",
				apiKey: "sk-existing-key",
			},
		)

		expect(profile.apiKey).toBe("sk-existing-key")
		expect(prompts).toContain("API key")
		expect(prompts).toContain("1. Use existing API key")
		expect(prompts).toContain("2. Configure new API key")
		expect(prompts).not.toContain("sk-existing-key")
	})

	test("replaces the existing API key when selected", async () => {
		const { result: profile, prompts } = await collectWithAnswers(
			[
				"third-party-profile",
				"2",
				"2",
				"",
				"1",
				"2",
				"sk-new-key",
				"sk-local-client-key",
				"",
				"",
			],
			{
				sourceKind: "openai",
				upstreamApiFormat: "chat",
				apiKey: "sk-existing-key",
			},
		)

		expect(profile.apiKey).toBe("sk-new-key")
		expect(prompts).toContain("API key")
		expect(prompts).toContain("1. Use existing API key")
		expect(prompts).toContain("2. Configure new API key")
		expect(prompts).not.toContain("sk-existing-key")
	})

	test("collects a test action after profile setup", async () => {
		const { result, prompts } = await withMockedQuestions(["1"], async () => {
			const { collectPostConfigActionInteractively } = await import(
				"../src/interactive.js"
			)
			return collectPostConfigActionInteractively()
		})

		expect(result).toBe("test")
		expect(prompts).toContain("Next action")
		expect(prompts).toContain("1. Test profile")
		expect(prompts).toContain("2. End setup")
		expect(prompts).not.toContain("(test/end)")
	})

	test("collects an end action after profile setup", async () => {
		const { result, prompts } = await withMockedQuestions(["2"], async () => {
			const { collectPostConfigActionInteractively } = await import(
				"../src/interactive.js"
			)
			return collectPostConfigActionInteractively()
		})

		expect(result).toBe("end")
		expect(prompts).toContain("Next action")
		expect(prompts).toContain("1. Test profile")
		expect(prompts).toContain("2. End setup")
		expect(prompts).not.toContain("(test/end)")
	})

	test("does not default the post-config action from blank input", async () => {
		const { result, prompts } = await withMockedQuestions(
			["", "1"],
			async () => {
				const { collectPostConfigActionInteractively } = await import(
					"../src/interactive.js"
				)
				return collectPostConfigActionInteractively()
			},
		)

		expect(result).toBe("test")
		expect(prompts.match(/Next action/g)?.length).toBe(2)
		expect(prompts).not.toContain("(default)")
	})

	test("accepts enter-only post-config action in TTY mode after the menu is ready", async () => {
		vi.useFakeTimers()
		try {
			const { result, writes } = await withMockedTtyKeys(
				[{ delayMs: 300, name: "return" }],
				async () => {
					const { collectPostConfigActionInteractively } = await import(
						"../src/interactive.js"
					)
					return collectPostConfigActionInteractively()
				},
			)

			expect(result).toBe("test")
			expect(writes.match(/Next action/g)?.length).toBe(1)
		} finally {
			vi.useRealTimers()
		}
	})

	test("still accepts numeric post-config action in TTY mode", async () => {
		const { result, writes } = await withMockedTtyKeys(
			[{ sequence: "1" }],
			async () => {
				const { collectPostConfigActionInteractively } = await import(
					"../src/interactive.js"
				)
				return collectPostConfigActionInteractively()
			},
		)

		expect(result).toBe("test")
		expect(writes.match(/Next action/g)?.length).toBe(1)
	})

	test("redraws TTY choices in place instead of appending more menus", async () => {
		const { result, clearScreenDown, events, moveCursor } =
			await withMockedTtyKeys(
				[{ name: "down" }, { name: "up" }, { sequence: "1" }],
				async () => {
					const { collectPostConfigActionInteractively } = await import(
						"../src/interactive.js"
					)
					return collectPostConfigActionInteractively()
				},
			)

		expect(result).toBe("test")
		expect(moveCursor).toHaveBeenCalled()
		expect(clearScreenDown).toHaveBeenCalled()
		const redrawIndex = events.findIndex(
			(event, index) => index > 0 && event.includes("Next action"),
		)
		expect(events.slice(0, redrawIndex)).toContain("move")
		expect(events.slice(0, redrawIndex)).toContain("clear")
	})

	test("ignores immediate leftover enter when post-config action opens", async () => {
		vi.useFakeTimers()
		try {
			const pending = withMockedTtyKeys(
				[{ name: "return" }, { sequence: "2" }],
				async () => {
					const { collectPostConfigActionInteractively } = await import(
						"../src/interactive.js"
					)
					return collectPostConfigActionInteractively()
				},
			)
			await vi.advanceTimersByTimeAsync(300)
			const { result } = await pending

			expect(result).toBe("end")
		} finally {
			vi.useRealTimers()
		}
	})
})
