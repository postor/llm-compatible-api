import { stdin as input, stdout as output } from "node:process"
import readline from "node:readline"
import { createInterface } from "node:readline/promises"
import { OPENAI_DEFAULT_BASE_URL } from "./runtime.js"
import type { StoredBridgeProfile } from "./types.js"

type UpstreamProvider = "official" | "unofficial" | "anthropic"
type OpenAICompatibleApiFormat = "responses" | "chat"
type ExistingSecretAction = "keep" | "replace"
type SourceApiKeyModeAction = "separate" | "bypass" | "none"
export type PostConfigAction = "test" | "end"

type Choice<T extends string> = {
	label: string
	value: T
}

type PromptSession = {
	question: (prompt: string) => Promise<string | undefined>
	close: () => void
}

const upstreamPresets: Record<
	UpstreamProvider,
	Pick<StoredBridgeProfile, "sourceKind" | "baseURL">
> = {
	official: {
		sourceKind: "codex",
		baseURL: "https://chatgpt.com/backend-api/codex",
	},
	unofficial: {
		sourceKind: "openai",
		baseURL: OPENAI_DEFAULT_BASE_URL,
	},
	anthropic: {
		sourceKind: "anthropic",
		baseURL: "https://api.anthropic.com/v1",
	},
}

const createBufferedPromptSession = (): PromptSession => {
	const rl = readline.createInterface({ input, terminal: false })
	const lines: string[] = []
	const pending: Array<(value: string | undefined) => void> = []
	let closed = false

	rl.on("line", (line) => {
		const resolve = pending.shift()
		if (resolve) {
			resolve(line)
			return
		}
		lines.push(line)
	})
	rl.on("close", () => {
		closed = true
		for (const resolve of pending.splice(0)) {
			resolve(undefined)
		}
	})

	return {
		question: (prompt: string) => {
			output.write(prompt)
			const line = lines.shift()
			if (line !== undefined) {
				return Promise.resolve(line)
			}
			if (closed) {
				return Promise.resolve(undefined)
			}
			return new Promise((resolve) => {
				pending.push(resolve)
			})
		},
		close: () => {
			rl.close()
		},
	}
}

const createPromptSession = (): PromptSession => {
	if (input.isTTY && output.isTTY) {
		return createInterface({ input, output })
	}

	return createBufferedPromptSession()
}

const ask = async (
	rl: PromptSession,
	label: string,
	defaultValue?: string,
): Promise<string> => {
	const suffix =
		typeof defaultValue === "string" && defaultValue.length > 0
			? ` [${defaultValue}]`
			: ""
	const answer = (await rl.question(`${label}${suffix}: `))?.trim() ?? ""
	return answer.length > 0 ? answer : (defaultValue ?? "")
}

const askRequiredChoice = async (
	rl: PromptSession,
	label: string,
	choices: Array<Choice<string>>,
): Promise<string> => {
	const answer = await rl.question(
		`${toChoicePrompt(label, choices)}\nChoose: `,
	)
	if (answer === undefined) {
		throw new Error(`${label} requires a selection.`)
	}
	return answer.trim()
}

const toChoicePrompt = <T extends string>(
	label: string,
	choices: Array<Choice<T>>,
	defaultIndex?: number,
): string => {
	const lines = [
		label,
		...choices.map((choice, index) => {
			const marker = index === defaultIndex ? " (default)" : ""
			return `${index + 1}. ${choice.label}${marker}`
		}),
	]
	return lines.join("\n")
}

const chooseWithQuestion = async <T extends string>(
	rl: PromptSession,
	label: string,
	choices: Array<Choice<T>>,
	defaultValue: T,
): Promise<T> => {
	const defaultIndex = Math.max(
		0,
		choices.findIndex((choice) => choice.value === defaultValue),
	)
	const answer = await ask(
		rl,
		`${toChoicePrompt(label, choices, defaultIndex)}\nChoose`,
		String(defaultIndex + 1),
	)
	const selectedIndex = Number.parseInt(answer, 10) - 1
	return choices[selectedIndex]?.value ?? defaultValue
}

const chooseWithKeys = async <T extends string>(
	label: string,
	choices: Array<Choice<T>>,
	defaultValue: T,
	options: { requireMovementBeforeEnter?: boolean } = {},
): Promise<T> => {
	const openedAt = Date.now()
	const defaultIndex = Math.max(
		0,
		choices.findIndex((choice) => choice.value === defaultValue),
	)
	let selectedIndex = defaultIndex
	let renderedLineCount = 0

	readline.emitKeypressEvents(input)
	if (input.isTTY) {
		input.setRawMode(true)
	}

	const render = () => {
		if (renderedLineCount > 0) {
			readline.moveCursor(output, 0, -renderedLineCount)
			readline.clearScreenDown(output)
		}

		const lines = [`${label}`]
		for (const [index, choice] of choices.entries()) {
			const marker = index === selectedIndex ? ">" : " "
			lines.push(`${marker} ${choice.label}`)
		}
		lines.push("Use arrow keys and press Enter.")
		output.write(`${lines.join("\n")}\n`)
		renderedLineCount = lines.length
	}

	return new Promise<T>((resolve) => {
		const cleanup = (value: T) => {
			input.off("keypress", onKeypress)
			if (input.isTTY) {
				input.setRawMode(false)
			}
			output.write("\n")
			resolve(value)
		}
		const onKeypress = (
			_: string,
			key: { name?: string; sequence?: string },
		) => {
			if (key.name === "up") {
				selectedIndex = (selectedIndex - 1 + choices.length) % choices.length
				render()
				return
			}
			if (key.name === "down") {
				selectedIndex = (selectedIndex + 1) % choices.length
				render()
				return
			}
			if (key.name === "return") {
				if (options.requireMovementBeforeEnter && Date.now() - openedAt < 250) {
					render()
					return
				}
				cleanup(choices[selectedIndex]?.value ?? defaultValue)
				return
			}

			const numericIndex =
				typeof key.sequence === "string"
					? Number.parseInt(key.sequence, 10) - 1
					: Number.NaN
			if (Number.isInteger(numericIndex) && choices[numericIndex]) {
				selectedIndex = numericIndex
				const selected = choices[numericIndex]
				cleanup(selected.value)
			}
		}

		render()
		input.on("keypress", onKeypress)
	})
}

const choose = async <T extends string>(
	rl: PromptSession,
	label: string,
	choices: Array<Choice<T>>,
	defaultValue: T,
): Promise<T> => {
	if (input.isTTY && output.isTTY) {
		return chooseWithKeys(label, choices, defaultValue)
	}

	return chooseWithQuestion(rl, label, choices, defaultValue)
}

const chooseRequiredWithQuestion = async <T extends string>(
	rl: PromptSession,
	label: string,
	choices: Array<Choice<T>>,
): Promise<T> => {
	while (true) {
		const answer = await askRequiredChoice(rl, label, choices)
		const selectedIndex = Number.parseInt(answer, 10) - 1
		const selected = choices[selectedIndex]?.value
		if (selected) {
			return selected
		}
	}
}

const chooseRequired = async <T extends string>(
	rl: PromptSession,
	label: string,
	choices: Array<Choice<T>>,
): Promise<T> => {
	const firstChoice = choices[0]
	if (!firstChoice) {
		throw new Error(`${label} requires at least one choice.`)
	}

	if (input.isTTY && output.isTTY) {
		return chooseWithKeys(label, choices, firstChoice.value, {
			requireMovementBeforeEnter: true,
		})
	}

	return chooseRequiredWithQuestion(rl, label, choices)
}

const normalizeHeaders = (
	value: string,
): Record<string, string> | undefined => {
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

const providerFromSourceKind = (
	sourceKind: StoredBridgeProfile["sourceKind"] | undefined,
): UpstreamProvider => {
	if (sourceKind === "codex") {
		return "official"
	}

	if (sourceKind === "anthropic") {
		return "anthropic"
	}

	return "unofficial"
}

const apiFormatFromProfile = (
	value: StoredBridgeProfile["upstreamApiFormat"] | undefined,
): OpenAICompatibleApiFormat => (value === "responses" ? "responses" : "chat")

const collectApiKey = async (
	rl: PromptSession,
	existingApiKey: string | undefined,
): Promise<string> => {
	if (typeof existingApiKey !== "string" || existingApiKey.length === 0) {
		return ask(rl, "API key")
	}

	const action = await choose<ExistingSecretAction>(
		rl,
		"API key",
		[
			{ label: "Use existing API key", value: "keep" },
			{ label: "Configure new API key", value: "replace" },
		],
		"keep",
	)
	if (action === "keep") {
		return existingApiKey
	}

	return ask(rl, "New API key")
}

type CollectedApiKeyMode = {
	apiKey: string
	exposedApiKey: string
	clientApiKeyMode?: "bypass"
}

const collectSourceApiKeyMode = async (
	rl: PromptSession,
	sourceKind: StoredBridgeProfile["sourceKind"],
	existing?: Partial<StoredBridgeProfile>,
): Promise<CollectedApiKeyMode> => {
	if (sourceKind === "codex") {
		const exposedApiKey = await ask(
			rl,
			"Client API key (blank to allow local requests without a key)",
			existing?.exposedApiKey ?? "",
		)
		return {
			apiKey: "",
			exposedApiKey,
		}
	}

	const action = await choose<SourceApiKeyModeAction>(
		rl,
		"Source API key mode",
		[
			{ label: "Use separate client API key", value: "separate" },
			{ label: "Bypass client API key to upstream", value: "bypass" },
			{ label: "No client API key", value: "none" },
		],
		existing?.clientApiKeyMode === "bypass"
			? "bypass"
			: existing?.exposedApiKey
				? "separate"
				: "none",
	)

	if (action === "bypass") {
		return {
			apiKey: "",
			exposedApiKey: "",
			clientApiKeyMode: "bypass",
		}
	}

	const apiKey = await collectApiKey(rl, existing?.apiKey)
	if (action === "separate") {
		return {
			apiKey,
			exposedApiKey: await ask(
				rl,
				"New client API key",
				existing?.exposedApiKey ?? "",
			),
		}
	}

	return {
		apiKey,
		exposedApiKey: "",
	}
}

export const collectProfileInteractively = async (
	existing?: Partial<StoredBridgeProfile>,
): Promise<StoredBridgeProfile> => {
	const rl = createPromptSession()
	try {
		return collectProfileWithReadline(rl, existing)
	} finally {
		rl.close()
	}
}

const collectProfileWithReadline = async (
	rl: PromptSession,
	existing?: Partial<StoredBridgeProfile>,
): Promise<StoredBridgeProfile> => {
	const name = await ask(rl, "Profile name", existing?.name ?? "default")
	const defaultProvider = providerFromSourceKind(existing?.sourceKind)
	const provider = await choose(
		rl,
		"Upstream provider",
		[
			{ label: "Official Codex", value: "official" },
			{
				label: "Third-party OpenAI-compatible",
				value: "unofficial",
			},
			{ label: "Anthropic", value: "anthropic" },
		],
		defaultProvider,
	)
	const preset = upstreamPresets[provider]
	const sourceKind = preset.sourceKind
	const upstreamApiFormat =
		sourceKind === "openai"
			? await choose(
					rl,
					"OpenAI-compatible API format",
					[
						{ label: "Responses API", value: "responses" },
						{ label: "Chat Completions", value: "chat" },
					],
					apiFormatFromProfile(existing?.upstreamApiFormat),
				)
			: undefined
	const baseURL =
		sourceKind === "openai"
			? await ask(rl, "Upstream base URL", existing?.baseURL ?? preset.baseURL)
			: preset.baseURL
	const authFilePath =
		sourceKind === "codex"
			? await ask(
					rl,
					"Auth file path (blank to skip)",
					existing?.authFilePath ?? "~/.codex/auth.json",
				)
			: ""
	const apiKeyMode = await collectSourceApiKeyMode(rl, sourceKind, existing)
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
		sourceKind,
		upstreamApiFormat,
		baseURL,
		authFilePath: authFilePath || undefined,
		apiKey: apiKeyMode.apiKey || undefined,
		apiKeyEnvVar: undefined,
		authTokenEnvVar: undefined,
		exposedApiKey: apiKeyMode.exposedApiKey || undefined,
		clientApiKeyMode: apiKeyMode.clientApiKeyMode,
		host: host || undefined,
		port: Number.isFinite(Number(portValue)) ? Number(portValue) : undefined,
		headers: normalizeHeaders(headersValue),
	}
}

export const collectPostConfigActionInteractively =
	async (): Promise<PostConfigAction> => {
		const rl = createPromptSession()
		try {
			return collectPostConfigActionWithReadline(rl)
		} finally {
			rl.close()
		}
	}

const collectPostConfigActionWithReadline = async (
	rl: PromptSession,
): Promise<PostConfigAction> =>
	chooseRequired(rl, "Next action", [
		{ label: "Test profile", value: "test" },
		{ label: "End setup", value: "end" },
	])

export const collectInitInteractively = async (
	existing?: Partial<StoredBridgeProfile>,
): Promise<{ action: PostConfigAction; profile: StoredBridgeProfile }> => {
	const rl = createPromptSession()
	try {
		const profile = await collectProfileWithReadline(rl, existing)
		const action = await collectPostConfigActionWithReadline(rl)
		return { action, profile }
	} finally {
		rl.close()
	}
}
