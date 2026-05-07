import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
	getStoredProfile,
	readProfileStore,
	removeProfile,
	resolveProfileStorePath,
	saveProfile,
	setDefaultProfile,
} from "../src/profile-store.js"

const originalHome = process.env.HOME

afterEach(async () => {
	if (originalHome === undefined) {
		delete process.env.HOME
	} else {
		process.env.HOME = originalHome
	}
})

describe("profile store", () => {
	test("saves multiple profiles and switches the default", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "llm-compatible-api-"))
		process.env.HOME = root

		await saveProfile(
			{
				name: "codex-default",
				sourceKind: "codex",
				baseURL: "https://chatgpt.com/backend-api/codex",
				authFilePath: "~/.codex/auth.json",
			},
			{ setDefault: true },
		)
		await saveProfile({
			name: "anthropic-proxy",
			sourceKind: "anthropic",
			baseURL: "https://api.anthropic.com/v1",
			apiKeyEnvVar: "ANTHROPIC_API_KEY",
		})

		const store = await readProfileStore()
		expect(store.defaultProfile).toBe("codex-default")
		expect(Object.keys(store.profiles).sort()).toEqual([
			"anthropic-proxy",
			"codex-default",
		])

		expect((await setDefaultProfile("anthropic-proxy"))).toBe(true)
		expect((await getStoredProfile())?.name).toBe("anthropic-proxy")

		expect((await removeProfile("anthropic-proxy"))).toBe(true)
		expect((await getStoredProfile())?.name).toBe("codex-default")

		await fs.rm(root, { recursive: true, force: true })
	})

	test("uses the home directory based config path", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "llm-compatible-api-"))
		process.env.HOME = root

		expect(resolveProfileStorePath()).toBe(
			path.join(root, ".llm-compatible-api", "config.json"),
		)

		await fs.rm(root, { recursive: true, force: true })
	})
})
