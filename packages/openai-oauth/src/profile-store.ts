import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { BridgeProfileStore, StoredBridgeProfile } from "./types.js"

const PROFILE_DIRNAME = ".llm-compatible-api"
const PROFILE_FILENAME = "config.json"

const defaultStore = (): BridgeProfileStore => ({
	version: 1,
	profiles: {},
})

export const resolveProfileStorePath = (): string =>
	path.join(process.env.HOME ?? os.homedir(), PROFILE_DIRNAME, PROFILE_FILENAME)

export const readProfileStore = async (): Promise<BridgeProfileStore> => {
	const filePath = resolveProfileStorePath()
	try {
		const content = await fs.readFile(filePath, "utf-8")
		const parsed = JSON.parse(content) as Partial<BridgeProfileStore>
		return {
			version: 1,
			defaultProfile:
				typeof parsed.defaultProfile === "string"
					? parsed.defaultProfile
					: undefined,
			profiles:
				parsed.profiles && typeof parsed.profiles === "object"
					? (parsed.profiles as Record<string, StoredBridgeProfile>)
					: {},
		}
	} catch {
		return defaultStore()
	}
}

export const writeProfileStore = async (
	store: BridgeProfileStore,
): Promise<void> => {
	const filePath = resolveProfileStorePath()
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, JSON.stringify(store, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	})
}

export const saveProfile = async (
	profile: StoredBridgeProfile,
	options?: { setDefault?: boolean },
): Promise<void> => {
	const store = await readProfileStore()
	store.profiles[profile.name] = profile
	if (options?.setDefault || store.defaultProfile == null) {
		store.defaultProfile = profile.name
	}
	await writeProfileStore(store)
}

export const removeProfile = async (name: string): Promise<boolean> => {
	const store = await readProfileStore()
	if (!(name in store.profiles)) {
		return false
	}

	delete store.profiles[name]
	if (store.defaultProfile === name) {
		store.defaultProfile = Object.keys(store.profiles)[0]
	}
	await writeProfileStore(store)
	return true
}

export const setDefaultProfile = async (name: string): Promise<boolean> => {
	const store = await readProfileStore()
	if (!(name in store.profiles)) {
		return false
	}

	store.defaultProfile = name
	await writeProfileStore(store)
	return true
}

export const getStoredProfile = async (
	name?: string,
): Promise<StoredBridgeProfile | undefined> => {
	const store = await readProfileStore()
	const resolvedName = name ?? store.defaultProfile
	return resolvedName ? store.profiles[resolvedName] : undefined
}
