import { describe, expect, test } from "vitest"
import {
	resetCodexClientVersionCache,
	resolveCodexClientVersion,
	resolveOpenAIOAuthModels,
} from "../src/models.js"

describe("model discovery", () => {
	test("prefers the local codex cli version", async () => {
		resetCodexClientVersionCache()

		const version = await resolveCodexClientVersion({
			runCommand: async () => ({
				stdout: "codex-cli 0.111.0\n",
				stderr: "",
			}),
			fetchImpl: async () => {
				throw new Error("remote lookup should not run")
			},
		})

		expect(version).toBe("0.111.0")
	})

	test("falls back to the npm registry version", async () => {
		resetCodexClientVersionCache()

		const version = await resolveCodexClientVersion({
			runCommand: async () => {
				throw new Error("codex is not installed")
			},
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						version: "0.114.0",
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
						},
					},
				),
		})

		expect(version).toBe("0.114.0")
	})

	test("uses an explicit codex version override when provided", async () => {
		resetCodexClientVersionCache()

		const version = await resolveCodexClientVersion({
			codexVersion: "0.200.0",
			runCommand: async () => {
				throw new Error("local lookup should not run")
			},
			fetchImpl: async () => {
				throw new Error("remote lookup should not run")
			},
		})

		expect(version).toBe("0.200.0")
	})

	test("uses a pinned fallback when local and remote version discovery fail", async () => {
		resetCodexClientVersionCache()
		const warnings: string[] = []

		const version = await resolveCodexClientVersion({
			runCommand: async () => {
				throw new Error("codex is not installed")
			},
			fetchImpl: async () => {
				throw new Error("network unavailable")
			},
			onWarning: (message) => {
				warnings.push(message)
			},
		})

		expect(version).toBe("0.111.0")
		expect(warnings).toEqual([
			"Could not determine the Codex API version automatically. Falling back to 0.111.0. Pass a version explicitly with --codex-version if you need to override it.",
		])
	})

	test("returns configured models without upstream discovery", async () => {
		resetCodexClientVersionCache()

		const models = await resolveOpenAIOAuthModels(
			{
				baseURL: "https://chatgpt.com/backend-api/codex",
				fetch: async () => {
					throw new Error("upstream fetch should not run")
				},
				request: async () => {
					throw new Error("upstream fetch should not run")
				},
			},
			["gpt-5.4", "gpt-5.3-codex", "gpt-5.4"],
		)

		expect(models).toEqual(["gpt-5.4", "gpt-5.3-codex"])
	})

	test("loads standard upstream models for /v1 providers", async () => {
		resetCodexClientVersionCache()

		const models = await resolveOpenAIOAuthModels(
			{
				baseURL: "https://example.test/v1",
				fetch: async () => {
					throw new Error("upstream fetch should not run")
				},
				request: async () =>
					new Response(
						JSON.stringify({
							object: "list",
							data: [
								{ id: "gpt-4.1" },
								{ id: "o4-mini" },
								{ id: "gpt-4.1" },
							],
						}),
						{
							status: 200,
							headers: {
								"Content-Type": "application/json",
							},
						},
					),
			},
			undefined,
		)

		expect(models).toEqual(["gpt-4.1", "o4-mini"])
	})
})
