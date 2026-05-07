import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { type CodexOAuthSettings } from "../../openai-oauth-core/src/index.js"
import { handleAnthropicMessagesRequest } from "./anthropic-messages.js"
import { handleChatCompletionsRequest } from "./chat-completions.js"
import { createRequestLogger } from "./logging.js"
import { handleResponsesRequest } from "./responses.js"
import { createBridgeRuntime } from "./runtime.js"
import {
	corsHeaders,
	DEFAULT_HOST,
	DEFAULT_PORT,
	resolveAddress,
	toErrorResponse,
	toJsonResponse,
	toWebRequest,
	writeWebResponse,
} from "./shared.js"
import type {
	BridgeRuntime,
	OpenAIOAuthServerOptions,
	RunningOpenAIOAuthServer,
} from "./types.js"

const readBearerToken = (request: Request): string | undefined => {
	const authorization = request.headers.get("authorization")
	if (typeof authorization !== "string") {
		return undefined
	}

	const match = authorization.match(/^Bearer\s+(.+)$/i)
	return match?.[1]?.trim()
}

const requireClientApiKey = (
	request: Request,
	settings: OpenAIOAuthServerOptions,
): { response?: Response; upstreamApiKey?: string } => {
	const bearerToken = readBearerToken(request)
	if (settings.clientApiKeyMode === "bypass") {
		if (!bearerToken) {
			return {
				response: toErrorResponse(
					"Missing or invalid API key.",
					401,
					"authentication_error",
				),
			}
		}

		return { upstreamApiKey: bearerToken }
	}

	if (settings.exposedApiKey && bearerToken !== settings.exposedApiKey) {
		return {
			response: toErrorResponse(
				"Missing or invalid API key.",
				401,
				"authentication_error",
			),
		}
	}

	return {}
}

const toRequestRuntime = (
	settings: OpenAIOAuthServerOptions,
	defaultRuntime: BridgeRuntime,
	upstreamApiKey: string | undefined,
): BridgeRuntime =>
	upstreamApiKey
		? createBridgeRuntime({
				...settings,
				apiKey: upstreamApiKey,
				apiKeyEnvVar: undefined,
				authToken: undefined,
				authTokenEnvVar: undefined,
			})
		: defaultRuntime

const handleRoutes = async (
	request: Request,
	settings: OpenAIOAuthServerOptions,
	defaultRuntime: BridgeRuntime,
	requestLogger: ReturnType<typeof createRequestLogger>,
): Promise<Response> => {
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: corsHeaders,
		})
	}

	const clientAuth = requireClientApiKey(request, settings)
	if (clientAuth.response) {
		return clientAuth.response
	}
	const runtime = toRequestRuntime(
		settings,
		defaultRuntime,
		clientAuth.upstreamApiKey,
	)

	const url = new URL(request.url)
	if (request.method === "GET" && url.pathname === "/health") {
		return toJsonResponse({
			ok: true,
			replay_state: "stateless",
			source: runtime.sourceKind,
			targets: ["openai", "anthropic"],
		})
	}

	if (request.method === "GET" && url.pathname === "/v1/models") {
		try {
			const models = await runtime.resolveModels()
			return toJsonResponse({
				object: "list",
				data: models.map((id) => ({
					id,
					object: "model",
					created: 0,
					owned_by: runtime.sourceKind,
				})),
			})
		} catch (error) {
			return toErrorResponse(
				error instanceof Error ? error.message : "Failed to load models.",
				502,
				"upstream_error",
			)
		}
	}

	if (request.method === "POST" && url.pathname === "/v1/responses") {
		return handleResponsesRequest(request, settings, runtime)
	}

	if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
		return handleChatCompletionsRequest(request, runtime, requestLogger)
	}

	if (request.method === "POST" && url.pathname === "/v1/messages") {
		return handleAnthropicMessagesRequest(request, runtime, requestLogger)
	}

	return toErrorResponse("Route not found.", 404, "not_found_error")
}

export const createOpenAIOAuthFetchHandler = (
	settings: OpenAIOAuthServerOptions = {},
): ((request: Request) => Promise<Response>) => {
	const sharedSettings: CodexOAuthSettings = {
		...settings,
		responsesState: false,
	}
	const runtime = createBridgeRuntime(sharedSettings)
	const requestLogger = createRequestLogger(settings)

	return async (request) => {
		try {
			return await handleRoutes(request, settings, runtime, requestLogger)
		} catch (error) {
			return toErrorResponse(
				error instanceof Error ? error.message : "Unexpected server error.",
				500,
				"server_error",
			)
		}
	}
}

export const startOpenAIOAuthServer = async (
	settings: OpenAIOAuthServerOptions = {},
): Promise<RunningOpenAIOAuthServer> => {
	const host = settings.host ?? DEFAULT_HOST
	const port = settings.port ?? DEFAULT_PORT
	const handler = createOpenAIOAuthFetchHandler(settings)
	const server = createServer(async (req, res) => {
		try {
			const request = await toWebRequest(req, { host, port })
			const response = await handler(request)
			await writeWebResponse(res, response)
		} catch (error) {
			if (res.headersSent || res.writableEnded) {
				res.destroy(error instanceof Error ? error : undefined)
				return
			}

			const message =
				error instanceof Error ? error.message : "Unexpected server error."
			await writeWebResponse(res, toErrorResponse(message, 500, "server_error"))
		}
	})

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(port, host, () => {
			server.off("error", reject)
			resolve()
		})
	})

	const address = resolveAddress(server.address() as AddressInfo, host)
	return {
		server,
		host: address.host,
		port: address.port,
		url: `http://${address.host}:${address.port}/v1`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error)
						return
					}

					resolve()
				})
			}),
	}
}
