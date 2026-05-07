import { createAnthropic } from "@ai-sdk/anthropic"
import {
	DEFAULT_CODEX_BASE_URL,
	type CodexOAuthSettings,
	createCodexOAuthClient,
} from "../../openai-oauth-core/src/index.js"
import { createOpenAIOAuth } from "../../openai-oauth-provider/src/index.js"
import { createModelResolver } from "./models.js"
import type {
	BridgeRuntime,
	BridgeSourceKind,
	OpenAIOAuthServerOptions,
} from "./types.js"

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1"

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

const resolveOpenAIDefaultModel = (settings: OpenAIOAuthServerOptions): string =>
	settings.defaultModel ?? settings.models?.[0] ?? "gpt-5.2"

const resolveAnthropicDefaultModel = (
	settings: OpenAIOAuthServerOptions,
): string => settings.defaultModel ?? settings.models?.[0] ?? "claude-sonnet-4-6"

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
): Record<string, string> => {
	const headers: Record<string, string> = {
		"anthropic-version":
			settings.headers?.["anthropic-version"] ?? "2023-06-01",
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
				throw new Error(text || "Failed to load models from the Anthropic source.")
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

			const models = [...new Set(data.map((entry) => entry.id).filter(
				(id): id is string => typeof id === "string" && id.length > 0,
			))]

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
		sourceKind: resolveSourceKind(settings),
		modelFactory: (modelId) => provider(modelId),
		resolveModels,
		defaultModel: resolveOpenAIDefaultModel(settings),
		supportsOpenAIResponses: true,
		requestOpenAIResponses: (body, signal) =>
			client.request("/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
				signal,
			}),
	}
}

const createAnthropicRuntime = (
	settings: OpenAIOAuthServerOptions,
): BridgeRuntime => {
	const provider = createAnthropic({
		baseURL: withoutTrailingSlash(settings.baseURL) ?? ANTHROPIC_DEFAULT_BASE_URL,
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
		modelFactory: (modelId) => provider(modelId),
		resolveModels: createAnthropicModelResolver(settings),
		defaultModel: resolveAnthropicDefaultModel(settings),
		supportsOpenAIResponses: false,
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
