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
	OpenAIOAuthServerOptions,
	RunningOpenAIOAuthServer,
} from "./types.js"

const handleRoutes = async (
	request: Request,
	settings: OpenAIOAuthServerOptions,
	runtime: ReturnType<typeof createBridgeRuntime>,
	requestLogger: ReturnType<typeof createRequestLogger>,
): Promise<Response> => {
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: corsHeaders,
		})
	}

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
