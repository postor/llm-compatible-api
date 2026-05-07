import { stdin as input, stdout as output } from "node:process"
import { createInterface } from "node:readline/promises"
import type { StoredBridgeProfile } from "./types.js"

const ask = async (
	rl: ReturnType<typeof createInterface>,
	label: string,
	defaultValue?: string,
): Promise<string> => {
	const suffix =
		typeof defaultValue === "string" && defaultValue.length > 0
			? ` [${defaultValue}]`
			: ""
	const answer = (await rl.question(`${label}${suffix}: `)).trim()
	return answer.length > 0 ? answer : (defaultValue ?? "")
}

const normalizeHeaders = (value: string): Record<string, string> | undefined => {
	if (value.trim().length === 0) {
		return undefined
	}

	const headers: Record<string, string> = {}
	for (const entry of value.split(",")) {
		const [rawKey, ...rest] = entry.split("=")
		const key = rawKey?.trim()
		const nextValue = rest.join("=").trim()
		if (key && nextValue) {
			headers[key] = nextValue
		}
	}

	return Object.keys(headers).length > 0 ? headers : undefined
}

export const collectProfileInteractively = async (
	existing?: Partial<StoredBridgeProfile>,
): Promise<StoredBridgeProfile> => {
	const rl = createInterface({ input, output })
	try {
		const name = await ask(rl, "Profile name", existing?.name ?? "default")
		const sourceKind = (await ask(
			rl,
			"Source kind (codex/openai/anthropic)",
			existing?.sourceKind ?? "openai",
		)) as StoredBridgeProfile["sourceKind"]

		const baseURLDefault =
			existing?.baseURL ??
			(sourceKind === "anthropic"
				? "https://api.anthropic.com/v1"
				: sourceKind === "codex"
					? "https://chatgpt.com/backend-api/codex"
					: "https://api.openai.com/v1")

		const baseURL = await ask(rl, "Upstream base URL", baseURLDefault)
		const authFilePath =
			sourceKind === "anthropic"
				? ""
				: await ask(
						rl,
						"Auth file path (blank to skip)",
						existing?.authFilePath ?? "~/.codex/auth.json",
					)
		const apiKeyEnvVar = await ask(
			rl,
			"API key env var (blank to skip)",
			existing?.apiKeyEnvVar ??
				(sourceKind === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"),
		)
		const authTokenEnvVar =
			sourceKind === "anthropic"
				? await ask(
						rl,
						"Auth token env var (blank to skip)",
						existing?.authTokenEnvVar ?? "",
					)
				: ""
		const defaultModel = await ask(
			rl,
			"Default model (blank to use built-in fallback)",
			existing?.defaultModel ?? "",
		)
		const host = await ask(rl, "Bind host", existing?.host ?? "127.0.0.1")
		const portValue = await ask(
			rl,
			"Bind port",
			typeof existing?.port === "number" ? String(existing.port) : "10531",
		)
		const headersValue = await ask(
			rl,
			"Extra headers key=value,key2=value2 (blank to skip)",
			existing?.headers
				? Object.entries(existing.headers)
						.map(([key, value]) => `${key}=${value}`)
						.join(",")
				: "",
		)

		return {
			name,
			sourceKind:
				sourceKind === "anthropic" || sourceKind === "codex"
					? sourceKind
					: "openai",
			baseURL,
			authFilePath: authFilePath || undefined,
			apiKeyEnvVar: apiKeyEnvVar || undefined,
			authTokenEnvVar: authTokenEnvVar || undefined,
			defaultModel: defaultModel || undefined,
			host: host || undefined,
			port: Number.isFinite(Number(portValue)) ? Number(portValue) : undefined,
			headers: normalizeHeaders(headersValue),
		}
	} finally {
		rl.close()
	}
}
