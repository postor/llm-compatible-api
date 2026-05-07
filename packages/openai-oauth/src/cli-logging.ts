const ansi = {
	dim: "\u001B[2m",
	reset: "\u001B[0m",
	underline: "\u001B[4m",
}

type CliWarning = {
	type: string
	feature?: string
	details?: string
	message?: string
}

const formatWarningMessage = (
	warning: CliWarning,
	provider: string,
	model: string,
): string => {
	const prefix = `llm-compatible-api Warning (${provider} / ${model}):`

	switch (warning.type) {
		case "unsupported": {
			let message = `${prefix} The feature "${warning.feature}" is not supported.`
			if (warning.details) {
				message += ` ${warning.details}`
			}
			return message
		}

		case "compatibility": {
			let message = `${prefix} The feature "${warning.feature}" is used in a compatibility mode.`
			if (warning.details) {
				message += ` ${warning.details}`
			}
			return message
		}

		case "other":
			return `${prefix} ${warning.message ?? "Unknown warning."}`

		default:
			return `${prefix} ${JSON.stringify(warning, null, 2)}`
	}
}

const withAnsi = (
	text: string,
	code: string,
	options?: { useColor?: boolean },
): string => {
	if (!options?.useColor) {
		return text
	}

	return `${code}${text}${ansi.reset}`
}

export const underline = (
	text: string,
	options?: { useColor?: boolean },
): string => withAnsi(text, ansi.underline, options)

export const dim = (text: string, options?: { useColor?: boolean }): string =>
	withAnsi(text, ansi.dim, options)

export const toStartupMessage = (
	baseUrl: string,
	availableModels: string[],
	options?: {
		useColor?: boolean
		sourceKind?: string
		requiresClientApiKey?: boolean
	},
): string =>
	[
		`OpenAI-compatible endpoint ready at ${underline(baseUrl, options)}`,
		`Anthropic-compatible endpoint ready at ${underline(baseUrl.replace(/\/v1$/, ""), options)}`,
		dim(
			options?.requiresClientApiKey
				? `Source: ${options?.sourceKind ?? "openai"} | Clients must send Authorization: Bearer <client API key>.`
				: `Source: ${options?.sourceKind ?? "openai"} | No client-side API key is required.`,
			options,
		),
		dim(
			"Use the /v1 base URL for OpenAI clients and the root URL for Anthropic clients.",
			options,
		),
		"",
		`Available Models: ${availableModels.join(", ")}`,
	].join("\n")

export const installCliWarningLogger = (): void => {
	let hasLoggedWarningSystemMessage = false

	globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) => {
		if (warnings.length === 0) {
			return
		}

		if (!hasLoggedWarningSystemMessage) {
			hasLoggedWarningSystemMessage = true
			console.info("")
			console.info(
				"llm-compatible-api Warning System: To turn off warning logging, set the AI_SDK_LOG_WARNINGS global to false.",
			)
		}

		for (const warning of warnings) {
			console.warn(formatWarningMessage(warning as CliWarning, provider, model))
		}
	}
}
