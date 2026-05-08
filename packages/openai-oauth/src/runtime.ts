import { createAnthropic } from "@ai-sdk/anthropic"
import {
	type CodexOAuthSettings,
	createCodexOAuthClient,
	DEFAULT_CODEX_BASE_URL,
} from "../../openai-oauth-core/src/index.js"
import { createOpenAIOAuth } from "../../openai-oauth-provider/src/index.js"
import { createModelResolver } from "./models.js"
import type {
	AnthropicCountTokensRequest,
	BridgeRuntime,
	BridgeSourceKind,
	OpenAIOAuthServerOptions,
} from "./types.js"

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const ANTHROPIC_OFFICIAL_BASE_URL = ANTHROPIC_DEFAULT_BASE_URL

const withoutTrailingSlash = (value: string | undefined): string | undefined =>
	typeof value === "string" ? value.replace(/\/+$/, "") : undefined

const resolveSourceKind = (
	settings: OpenAIOAuthServerOptions,
): BridgeSourceKind => {
	if (settings.sourceKind) {
		return settings.sourceKind
	}

	const baseURL = withoutTrailingSlash(settings.baseURL)
	if (baseURL == null || baseURL === DEFAULT_CODEX_BASE_URL) {
		return "codex"
	}

	if (baseURL.includes("anthropic")) {
		return "anthropic"
	}

	return "openai"
}

const resolveConfiguredSecret = (
	explicitValue: string | undefined,
	envVarName: string | undefined,
	fallbackEnvVarName: string,
): string | undefined => {
	if (typeof explicitValue === "string" && explicitValue.length > 0) {
		return explicitValue
	}

	const resolvedEnvVar =
		typeof envVarName === "string" && envVarName.length > 0
			? envVarName
			: fallbackEnvVarName

	const value = process.env[resolvedEnvVar]
	return typeof value === "string" && value.length > 0 ? value : undefined
}

const toAnthropicHeaders = (
	settings: OpenAIOAuthServerOptions,
	requestHeaders?: Headers,
): Record<string, string> => {
	const headers: Record<string, string> = {
		"anthropic-version":
			requestHeaders?.get("anthropic-version") ??
			settings.headers?.["anthropic-version"] ??
			"2023-06-01",
	}

	const betaHeader = requestHeaders?.get("anthropic-beta")
	if (betaHeader) {
		headers["anthropic-beta"] = betaHeader
	}

	const authToken = resolveConfiguredSecret(
		settings.authToken,
		settings.authTokenEnvVar,
		"ANTHROPIC_AUTH_TOKEN",
	)
	const apiKey = resolveConfiguredSecret(
		settings.apiKey,
		settings.apiKeyEnvVar,
		"ANTHROPIC_API_KEY",
	)

	if (authToken) {
		headers.Authorization = `Bearer ${authToken}`
	} else if (apiKey) {
		headers["x-api-key"] = apiKey
	} else {
		throw new Error(
			"Anthropic source requires authToken/authTokenEnvVar or apiKey/apiKeyEnvVar.",
		)
	}

	for (const [key, value] of Object.entries(settings.headers ?? {})) {
		headers[key] = value
	}

	return headers
}

const requestAnthropicCountTokens = async (
	settings: OpenAIOAuthServerOptions,
	body: AnthropicCountTokensRequest,
	headers: Headers | undefined,
	signal: AbortSignal | undefined,
): Promise<Response> => {
	const baseURL =
		withoutTrailingSlash(settings.baseURL) ?? ANTHROPIC_DEFAULT_BASE_URL

	return (settings.fetch ?? globalThis.fetch)(
		`${baseURL}/messages/count_tokens`,
		{
			method: "POST",
			headers: {
				...toAnthropicHeaders(settings, headers),
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal,
		},
	)
}

const createAnthropicModelResolver = (
	settings: OpenAIOAuthServerOptions,
): (() => Promise<string[]>) => {
	let cached: string[] | undefined
	let inflight: Promise<string[]> | undefined

	return async () => {
		if (Array.isArray(settings.models) && settings.models.length > 0) {
			return [...new Set(settings.models)]
		}

		if (cached) {
			return [...cached]
		}

		if (inflight) {
			return [...(await inflight)]
		}

		inflight = (async () => {
			const baseURL =
				withoutTrailingSlash(settings.baseURL) ?? ANTHROPIC_DEFAULT_BASE_URL
			const response = await (settings.fetch ?? globalThis.fetch)(
				`${baseURL}/models`,
				{
					method: "GET",
					headers: toAnthropicHeaders(settings),
				},
			)

			const text = await response.text()
			if (!response.ok) {
				throw new Error(
					text || "Failed to load models from the Anthropic source.",
				)
			}

			let parsed: unknown
			try {
				parsed = JSON.parse(text)
			} catch {
				throw new Error("Anthropic source returned an invalid models response.")
			}

			const data =
				typeof parsed === "object" &&
				parsed !== null &&
				"data" in parsed &&
				Array.isArray((parsed as { data?: unknown }).data)
					? (parsed as { data: Array<{ id?: unknown }> }).data
					: []

			const models = [
				...new Set(
					data
						.map((entry) => entry.id)
						.filter(
							(id): id is string => typeof id === "string" && id.length > 0,
						),
				),
			]

			if (models.length === 0) {
				throw new Error("Anthropic source returned an empty models list.")
			}

			cached = models
			inflight = undefined
			return models
		})().catch((error) => {
			inflight = undefined
			throw error
		})

		return [...(await inflight)]
	}
}

const createOpenAIRuntime = (
	settings: OpenAIOAuthServerOptions,
): BridgeRuntime => {
	const sourceKind = resolveSourceKind(settings)
	const upstreamApiFormat =
		sourceKind === "openai" ? (settings.upstreamApiFormat ?? "chat") : undefined
	const sharedSettings: CodexOAuthSettings = {
		...settings,
		responsesState: false,
	}
	const client = createCodexOAuthClient(sharedSettings)
	const provider = createOpenAIOAuth(sharedSettings)
	const resolveModels = createModelResolver(client, settings.models, {
		codexVersion: settings.codexVersion,
	})

	return {
		sourceKind,
		upstreamApiFormat,
		modelFactory: (modelId) => provider(modelId),
		resolveModels,
		supportsOpenAIResponses: upstreamApiFormat !== "chat",
		requestOpenAIResponses:
			upstreamApiFormat === "chat"
				? undefined
				: (body, signal) =>
						client.request("/responses", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							body: JSON.stringify(body),
							signal,
						}),
		requestChatCompletion: (body) =>
			client.request("/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			}),
	}
}

const createAnthropicRuntime = (
	settings: OpenAIOAuthServerOptions,
): BridgeRuntime => {
	const provider = createAnthropic({
		baseURL:
			withoutTrailingSlash(settings.baseURL) ?? ANTHROPIC_DEFAULT_BASE_URL,
		apiKey: resolveConfiguredSecret(
			settings.apiKey,
			settings.apiKeyEnvVar,
			"ANTHROPIC_API_KEY",
		),
		authToken: resolveConfiguredSecret(
			settings.authToken,
			settings.authTokenEnvVar,
			"ANTHROPIC_AUTH_TOKEN",
		),
		headers: settings.headers,
		fetch: settings.fetch,
		name: "anthropic.messages",
	})

	return {
		sourceKind: "anthropic",
		upstreamApiFormat: undefined,
		modelFactory: (modelId) => provider(modelId),
		resolveModels: createAnthropicModelResolver(settings),
		supportsOpenAIResponses: false,
		requestAnthropicCountTokens: (body, headers, signal) =>
			requestAnthropicCountTokens(settings, body, headers, signal),
	}
}

export const createBridgeRuntime = (
	settings: OpenAIOAuthServerOptions = {},
): BridgeRuntime => {
	const sourceKind = resolveSourceKind(settings)
	return sourceKind === "anthropic"
		? createAnthropicRuntime(settings)
		: createOpenAIRuntime(settings)
}
