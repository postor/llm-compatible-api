import {
	collectCompletedResponseFromSse,
	normalizeCodexResponsesBody,
} from "../../openai-oauth-core/src/index.js"
import {
	copyUpstreamResponse,
	corsHeaders,
	isRecord,
	sseHeaders,
	toErrorResponse,
	toJsonResponse,
	usesServerReplayState,
} from "./shared.js"
import type { BridgeRuntime, OpenAIOAuthServerOptions } from "./types.js"

export const handleResponsesRequest = async (
	request: Request,
	settings: OpenAIOAuthServerOptions,
	runtime: BridgeRuntime,
): Promise<Response> => {
	const body = await request.json()
	if (!isRecord(body)) {
		return toErrorResponse("Request body must be a JSON object.")
	}

	if (!runtime.supportsOpenAIResponses || !runtime.requestOpenAIResponses) {
		return toErrorResponse(
			"The active source does not support OpenAI /v1/responses passthrough. Use /v1/chat/completions or /v1/messages instead.",
			501,
			"unsupported_source",
		)
	}

	if (usesServerReplayState(body)) {
		return toErrorResponse(
			"Stateless Codex responses endpoint does not support `previous_response_id` or `item_reference`. Replay the full conversation history in `input` on each request.",
		)
	}

	const wantsStream = body.stream === true
	const upstream = await runtime.requestOpenAIResponses(
		normalizeCodexResponsesBody(body, {
			forceStream: true,
			instructions: settings.instructions,
			store: settings.store,
		}),
		request.signal,
	)

	if (!upstream.ok) {
		return copyUpstreamResponse(upstream)
	}

	if (wantsStream) {
		return new Response(upstream.body, {
			status: upstream.status,
			headers: {
				...sseHeaders,
				...corsHeaders,
			},
		})
	}

	const completed = await collectCompletedResponseFromSse(
		upstream.body ?? new ReadableStream(),
	)
	return toJsonResponse(completed)
}
