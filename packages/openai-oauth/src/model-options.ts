import { isJsonValue, isRecord } from "./shared.js"
import type {
	AnthropicMessageRequest,
	BridgeSourceKind,
	ChatRequest,
	JsonObject,
} from "./types.js"

const toAnthropicThinkingFromReasoningEffort = (
	reasoningEffort: ChatRequest["reasoning_effort"],
): JsonObject | undefined => {
	if (
		reasoningEffort == null ||
		reasoningEffort === "none" ||
		reasoningEffort === "minimal"
	) {
		return undefined
	}

	return {
		type: "adaptive",
		display: "summarized",
	}
}

export const toOpenAITargetProviderOptions = (
	sourceKind: BridgeSourceKind,
	request: ChatRequest,
): Record<string, JsonObject> | undefined => {
	if (sourceKind === "anthropic") {
		const anthropicOptions: JsonObject = {}
		const thinking = toAnthropicThinkingFromReasoningEffort(
			request.reasoning_effort,
		)
		if (thinking) {
			anthropicOptions.thinking = thinking
		}
		if (request.parallel_tool_calls === false) {
			anthropicOptions.disableParallelToolUse = true
		}

		return {
			anthropic: anthropicOptions,
		}
	}

	const openaiOptions: JsonObject = {}
	if (typeof request.parallel_tool_calls === "boolean") {
		openaiOptions.parallelToolCalls = request.parallel_tool_calls
	}
	if (typeof request.reasoning_effort === "string") {
		openaiOptions.reasoningEffort = request.reasoning_effort
	}

	return {
		openai: openaiOptions,
	}
}

export const toAnthropicTargetProviderOptions = (
	sourceKind: BridgeSourceKind,
	request: AnthropicMessageRequest,
): Record<string, JsonObject> | undefined => {
	if (sourceKind !== "anthropic") {
		return undefined
	}

	const anthropicOptions: JsonObject = {}

	if (isRecord(request.thinking)) {
		anthropicOptions.thinking = request.thinking as JsonObject
	}
	if (typeof request.effort === "string") {
		anthropicOptions.effort = request.effort
	}
	if (Array.isArray(request.anthropic_beta)) {
		anthropicOptions.anthropicBeta = request.anthropic_beta
	}
	if (isRecord(request.metadata) && typeof request.metadata.user_id === "string") {
		anthropicOptions.metadata = {
			userId: request.metadata.user_id,
		}
	}
	if (isJsonValue(request.container)) {
		anthropicOptions.container = request.container
	}
	if (isJsonValue(request.mcp_servers)) {
		anthropicOptions.mcpServers = request.mcp_servers
	}
	if (isJsonValue(request.context_management)) {
		anthropicOptions.contextManagement = request.context_management
	}
	if (typeof request.speed === "string") {
		anthropicOptions.speed = request.speed
	}
	if (typeof request.inference_geo === "string") {
		anthropicOptions.inferenceGeo = request.inference_geo
	}
	if (isJsonValue(request.task_budget)) {
		anthropicOptions.taskBudget = request.task_budget
	}

	return Object.keys(anthropicOptions).length > 0
		? { anthropic: anthropicOptions }
		: undefined
}
