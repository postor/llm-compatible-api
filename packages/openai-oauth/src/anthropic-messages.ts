import { Buffer } from "node:buffer"
import { generateText, jsonSchema, streamText, tool, type ModelMessage } from "ai"
import { emitRequestLog } from "./logging.js"
import { toAnthropicTargetProviderOptions } from "./model-options.js"
import {
	corsHeaders,
	isJsonValue,
	isRecord,
	sseHeaders,
	toErrorResponse,
} from "./shared.js"
import type {
	AnthropicContentBlock,
	AnthropicMessage,
	AnthropicMessageRequest,
	AnthropicToolChoice,
	AnthropicToolDefinition,
	BridgeRuntime,
	JsonValue,
	OpenAIOAuthServerLogEvent,
	ToolOutputValue,
	UsageLike,
} from "./types.js"

const anthropicHeaders = {
	"anthropic-version": "2023-06-01",
}

const encodeEvent = (event: string, data: unknown): Uint8Array =>
	new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

const toTextToolOutput = (value: string): ToolOutputValue => ({
	type: "text",
	value,
})

const toJsonToolOutput = (value: JsonValue): ToolOutputValue => ({
	type: "json",
	value,
})

const coerceToolOutput = (content: unknown): ToolOutputValue => {
	if (typeof content === "string") {
		try {
			return toJsonToolOutput(JSON.parse(content) as JsonValue)
		} catch {
			return toTextToolOutput(content)
		}
	}

	if (isJsonValue(content)) {
		return toJsonToolOutput(content)
	}

	return toTextToolOutput(String(content ?? ""))
}

const parseImageBlock = (
	block: AnthropicContentBlock,
): { type: "image"; image: Uint8Array; mediaType?: string } | undefined => {
	if (
		block.type !== "image" ||
		!isRecord(block.source) ||
		block.source.type !== "base64" ||
		typeof block.source.data !== "string"
	) {
		return undefined
	}

	try {
		return {
			type: "image",
			image: Uint8Array.from(Buffer.from(block.source.data, "base64")),
			mediaType:
				typeof block.source.media_type === "string"
					? block.source.media_type
					: undefined,
		}
	} catch {
		return undefined
	}
}

const toAnthropicUserParts = (
	content: string | AnthropicContentBlock[] | undefined,
): string | Array<
	| { type: "text"; text: string }
	| { type: "image"; image: Uint8Array; mediaType?: string }
> => {
	if (typeof content === "string") {
		return content
	}

	if (!Array.isArray(content)) {
		return ""
	}

	const parts: Array<
		| { type: "text"; text: string }
		| { type: "image"; image: Uint8Array; mediaType?: string }
	> = []

	for (const block of content) {
		if (block.type === "text" && typeof block.text === "string") {
			parts.push({ type: "text", text: block.text })
			continue
		}

		const imagePart = parseImageBlock(block)
		if (imagePart) {
			parts.push(imagePart)
			continue
		}

	}

	return parts.length > 0 ? parts : ""
}

const toAnthropicToolResults = (
	content: string | AnthropicContentBlock[] | undefined,
	toolNamesById: Map<string, string>,
): Array<{
	type: "tool-result"
	toolCallId: string
	toolName: string
	output: ToolOutputValue
	isError?: boolean
}> => {
	if (!Array.isArray(content)) {
		return []
	}

	const parts: Array<{
		type: "tool-result"
		toolCallId: string
		toolName: string
		output: ToolOutputValue
		isError?: boolean
	}> = []

	for (const block of content) {
		if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
			parts.push({
				type: "tool-result",
				toolCallId: block.tool_use_id,
				toolName: toolNamesById.get(block.tool_use_id) ?? "tool",
				output: coerceToolOutput(block.content),
				isError: block.is_error === true,
			})
		}
	}

	return parts
}

const toAnthropicAssistantContent = (
	content: string | AnthropicContentBlock[] | undefined,
	toolNamesById: Map<string, string>,
): string | Array<
	| { type: "text"; text: string }
	| { type: "reasoning"; text: string }
	| { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
> => {
	if (typeof content === "string") {
		return content
	}

	if (!Array.isArray(content)) {
		return ""
	}

	const parts: Array<
		| { type: "text"; text: string }
		| { type: "reasoning"; text: string }
		| { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
	> = []

	for (const block of content) {
		if (block.type === "text" && typeof block.text === "string") {
			parts.push({ type: "text", text: block.text })
			continue
		}

		if (
			block.type === "thinking" &&
			typeof block.thinking === "string" &&
			block.thinking.length > 0
		) {
			parts.push({ type: "reasoning", text: block.thinking })
			continue
		}

		if (
			block.type === "tool_use" &&
			typeof block.id === "string" &&
			typeof block.name === "string"
		) {
			toolNamesById.set(block.id, block.name)
			parts.push({
				type: "tool-call",
				toolCallId: block.id,
				toolName: block.name,
				input: block.input ?? {},
			})
		}
	}

	return parts.length > 0 ? parts : ""
}

const toAnthropicSystemText = (
	system: AnthropicMessageRequest["system"],
): string | undefined => {
	if (typeof system === "string") {
		return system
	}

	if (!Array.isArray(system)) {
		return undefined
	}

	const text = system
		.map((block) =>
			block.type === "text" && typeof block.text === "string" ? block.text : "",
		)
		.filter((part) => part.length > 0)
		.join("\n")

	return text.length > 0 ? text : undefined
}

const toAnthropicModelMessages = (
	request: AnthropicMessageRequest,
): ModelMessage[] => {
	const modelMessages: ModelMessage[] = []
	const toolNamesById = new Map<string, string>()

	const systemText = toAnthropicSystemText(request.system)
	if (systemText) {
		modelMessages.push({
			role: "system",
			content: systemText,
		})
	}

	for (const message of request.messages ?? []) {
		if (message.role === "user") {
			const userContent = toAnthropicUserParts(message.content)
			if (
				typeof userContent === "string"
					? userContent.length > 0
					: userContent.length > 0
			) {
				modelMessages.push({
					role: "user",
					content: userContent,
				})
			}

			for (const toolResult of toAnthropicToolResults(
				message.content,
				toolNamesById,
			)) {
				modelMessages.push({
					role: "tool",
					content: [toolResult],
				})
			}
		}

		if (message.role === "assistant") {
			modelMessages.push({
				role: "assistant",
				content: toAnthropicAssistantContent(message.content, toolNamesById),
			})
		}
	}

	return modelMessages
}

const createAnthropicToolSet = (
	tools: AnthropicToolDefinition[] | undefined,
): Record<string, ReturnType<typeof tool>> => {
	if (!Array.isArray(tools)) {
		return {}
	}

	const entries: Array<[string, ReturnType<typeof tool>]> = []
	for (const definition of tools) {
		if (typeof definition.name !== "string" || definition.name.length === 0) {
			continue
		}

		entries.push([
			definition.name,
			tool({
				description: definition.description,
				inputSchema: jsonSchema(
					definition.input_schema ?? {
						type: "object",
						properties: {},
						additionalProperties: true,
					},
				),
			}),
		])
	}

	return Object.fromEntries(entries)
}

const toAnthropicToolChoice = (
	toolChoice: AnthropicToolChoice | undefined,
):
	| "auto"
	| "none"
	| "required"
	| {
			type: "tool"
			toolName: string
	  }
	| undefined => {
	if (toolChoice == null || toolChoice.type == null || toolChoice.type === "auto") {
		return "auto"
	}

	if (toolChoice.type === "any") {
		return "required"
	}

	if (toolChoice.type === "none") {
		return "none"
	}

	if (toolChoice.type === "tool" && typeof toolChoice.name === "string") {
		return {
			type: "tool",
			toolName: toolChoice.name,
		}
	}

	return "auto"
}

const toAnthropicStopReason = (finishReason: string | undefined) => {
	switch (finishReason) {
		case "tool-calls":
			return "tool_use"
		case "length":
			return "max_tokens"
		default:
			return "end_turn"
	}
}

const toAnthropicUsage = (usage: UsageLike) => ({
	input_tokens: usage.inputTokens ?? 0,
	output_tokens: usage.outputTokens ?? 0,
	cache_read_input_tokens: usage.cachedInputTokens,
})

const summarizeAnthropicRequest = (request: AnthropicMessageRequest) => ({
	bodyKeys: Object.keys(request).sort(),
	messageCount: request.messages?.length ?? 0,
	messageRoles: (request.messages ?? [])
		.map((message) => message.role)
		.filter(
			(role): role is "user" | "assistant" =>
				role === "user" || role === "assistant",
		),
	model: request.model,
	reasoningEffort:
		typeof request.effort === "string" ? request.effort : undefined,
	stream: request.stream === true,
	toolCount: request.tools?.length ?? 0,
})

const toAnthropicResponseContent = (
	result: {
		text: string
		toolCalls: Array<{
			toolCallId: string
			toolName: string
			input: unknown
		}>
	},
) => {
	const content: Array<Record<string, unknown>> = []
	if (result.text.length > 0) {
		content.push({
			type: "text",
			text: result.text,
		})
	}

	for (const toolCall of result.toolCalls) {
		content.push({
			type: "tool_use",
			id: toolCall.toolCallId,
			name: toolCall.toolName,
			input: toolCall.input,
		})
	}

	return content
}

export const handleAnthropicMessagesRequest = async (
	request: Request,
	runtime: BridgeRuntime,
	logger: ((event: OpenAIOAuthServerLogEvent) => void) | undefined,
): Promise<Response> => {
	const requestId = crypto.randomUUID()
	const startedAt = Date.now()
	const body = (await request.json()) as AnthropicMessageRequest

	if (!isRecord(body) || !Array.isArray(body.messages)) {
		emitRequestLog(logger, {
			type: "anthropic_error",
			requestId,
			path: "/v1/messages",
			durationMs: Date.now() - startedAt,
			message: "`messages` must be an array.",
		})
		return toErrorResponse("`messages` must be an array.")
	}

	emitRequestLog(logger, {
		type: "anthropic_request",
		requestId,
		path: "/v1/messages",
		...summarizeAnthropicRequest(body),
	})

	if (body.stream === true) {
		return streamAnthropicMessages(body, runtime, {
			logger,
			requestId,
			startedAt,
		})
	}

	try {
		const result = await generateText({
			model: runtime.modelFactory(body.model ?? runtime.defaultModel),
			messages: toAnthropicModelMessages(body),
			tools: createAnthropicToolSet(body.tools),
			toolChoice: toAnthropicToolChoice(body.tool_choice),
			temperature: body.temperature,
			topP: body.top_p,
			stopSequences: Array.isArray(body.stop_sequences)
				? body.stop_sequences
				: undefined,
			maxOutputTokens: body.max_tokens,
			providerOptions: toAnthropicTargetProviderOptions(
				runtime.sourceKind,
				body,
			),
		})

		emitRequestLog(logger, {
			type: "anthropic_response",
			requestId,
			path: "/v1/messages",
			status: 200,
			stream: false,
			durationMs: Date.now() - startedAt,
			finishReason: result.finishReason,
			usage: result.usage,
		})

		return new Response(
			JSON.stringify({
				id: `msg_${crypto.randomUUID()}`,
				type: "message",
				role: "assistant",
				model: body.model ?? runtime.defaultModel,
				content: toAnthropicResponseContent(result),
				stop_reason: toAnthropicStopReason(result.finishReason),
				stop_sequence: null,
				usage: toAnthropicUsage(result.usage),
			}),
			{
				status: 200,
				headers: {
					"content-type": "application/json; charset=utf-8",
					...anthropicHeaders,
					...corsHeaders,
				},
			},
		)
	} catch (error) {
		emitRequestLog(logger, {
			type: "anthropic_error",
			requestId,
			path: "/v1/messages",
			durationMs: Date.now() - startedAt,
			message:
				error instanceof Error ? error.message : "Unexpected server error.",
		})
		throw error
	}
}

const streamAnthropicMessages = async (
	request: AnthropicMessageRequest,
	runtime: BridgeRuntime,
	logContext: {
		logger?: (event: OpenAIOAuthServerLogEvent) => void
		requestId: string
		startedAt: number
	},
): Promise<Response> => {
	const result = streamText({
		model: runtime.modelFactory(request.model ?? runtime.defaultModel),
		messages: toAnthropicModelMessages(request),
		tools: createAnthropicToolSet(request.tools),
		toolChoice: toAnthropicToolChoice(request.tool_choice),
		temperature: request.temperature,
		topP: request.top_p,
		stopSequences: Array.isArray(request.stop_sequences)
			? request.stop_sequences
			: undefined,
		maxOutputTokens: request.max_tokens,
		providerOptions: toAnthropicTargetProviderOptions(
			runtime.sourceKind,
			request,
		),
	})

	const messageId = `msg_${crypto.randomUUID()}`
	const contentIndexes = new Map<string, number>()
	let nextContentIndex = 0
	let reasoningIndex = 0

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(
				encodeEvent("message_start", {
					type: "message_start",
					message: {
						id: messageId,
						type: "message",
						role: "assistant",
						model: request.model ?? runtime.defaultModel,
						content: [],
						stop_reason: null,
						stop_sequence: null,
						usage: {
							input_tokens: 0,
							output_tokens: 0,
						},
					},
				}),
			)

			for await (const part of result.fullStream) {
				switch (part.type) {
					case "text-start": {
						const index = nextContentIndex++
						contentIndexes.set(part.id, index)
						controller.enqueue(
							encodeEvent("content_block_start", {
								type: "content_block_start",
								index,
								content_block: {
									type: "text",
									text: "",
								},
							}),
						)
						break
					}

					case "text-delta": {
						const index = contentIndexes.get(part.id)
						if (index == null) {
							break
						}

						controller.enqueue(
							encodeEvent("content_block_delta", {
								type: "content_block_delta",
								index,
								delta: {
									type: "text_delta",
									text: part.text,
								},
							}),
						)
						break
					}

					case "text-end": {
						const index = contentIndexes.get(part.id)
						if (index == null) {
							break
						}

						controller.enqueue(
							encodeEvent("content_block_stop", {
								type: "content_block_stop",
								index,
							}),
						)
						break
					}

					case "reasoning-start": {
						const index = nextContentIndex++
						contentIndexes.set(part.id, index)
						reasoningIndex = index
						controller.enqueue(
							encodeEvent("content_block_start", {
								type: "content_block_start",
								index,
								content_block: {
									type: "thinking",
									thinking: "",
								},
							}),
						)
						break
					}

					case "reasoning-delta": {
						const index = contentIndexes.get(part.id) ?? reasoningIndex
						controller.enqueue(
							encodeEvent("content_block_delta", {
								type: "content_block_delta",
								index,
								delta: {
									type: "thinking_delta",
									thinking: part.text,
								},
							}),
						)
						break
					}

					case "reasoning-end": {
						const index = contentIndexes.get(part.id)
						if (index == null) {
							break
						}
						controller.enqueue(
							encodeEvent("content_block_stop", {
								type: "content_block_stop",
								index,
							}),
						)
						break
					}

					case "tool-input-start": {
						const index = nextContentIndex++
						contentIndexes.set(part.id, index)
						controller.enqueue(
							encodeEvent("content_block_start", {
								type: "content_block_start",
								index,
								content_block: {
									type: "tool_use",
									id: part.id,
									name: part.toolName,
									input: {},
								},
							}),
						)
						break
					}

					case "tool-input-delta": {
						const index = contentIndexes.get(part.id)
						if (index == null) {
							break
						}

						controller.enqueue(
							encodeEvent("content_block_delta", {
								type: "content_block_delta",
								index,
								delta: {
									type: "input_json_delta",
									partial_json: part.delta,
								},
							}),
						)
						break
					}

					case "tool-input-end": {
						const index = contentIndexes.get(part.id)
						if (index == null) {
							break
						}
						controller.enqueue(
							encodeEvent("content_block_stop", {
								type: "content_block_stop",
								index,
							}),
						)
						break
					}

					case "finish":
						emitRequestLog(logContext.logger, {
							type: "anthropic_response",
							requestId: logContext.requestId,
							path: "/v1/messages",
							status: 200,
							stream: true,
							durationMs: Date.now() - logContext.startedAt,
							finishReason: part.finishReason,
							usage: part.totalUsage,
						})
						controller.enqueue(
							encodeEvent("message_delta", {
								type: "message_delta",
								delta: {
									stop_reason: toAnthropicStopReason(part.finishReason),
									stop_sequence: null,
								},
								usage: toAnthropicUsage(part.totalUsage),
							}),
						)
						break
					case "error":
						emitRequestLog(logContext.logger, {
							type: "anthropic_error",
							requestId: logContext.requestId,
							path: "/v1/messages",
							durationMs: Date.now() - logContext.startedAt,
							message:
								part.error instanceof Error
									? part.error.message
									: "Streaming anthropic message failed.",
						})
						controller.error(
							part.error instanceof Error
								? part.error
								: new Error("Streaming anthropic message failed.", {
										cause: part.error,
									}),
						)
						return
				}
			}

			controller.enqueue(encodeEvent("message_stop", { type: "message_stop" }))
			controller.close()
		},
	})

	return new Response(stream, {
		status: 200,
		headers: {
			...sseHeaders,
			...anthropicHeaders,
			...corsHeaders,
		},
	})
}
