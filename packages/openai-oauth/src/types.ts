import type { Server as HttpServer } from "node:http"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { CodexOAuthSettings } from "../../openai-oauth-core/src/index.js"

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| JsonObject
export type JsonObject = { [key: string]: JsonValue }

export type ToolOutputValue =
	| {
			type: "json"
			value: JsonValue
	  }
	| {
			type: "text"
			value: string
	  }

export type ChatToolDefinition = {
	type?: string
	function?: {
		name?: string
		description?: string
		parameters?: JsonObject
	}
}

export type ChatToolChoice =
	| "auto"
	| "none"
	| "required"
	| {
			type?: string
			function?: {
				name?: string
			}
	  }

export type ChatMessage = {
	role?: string
	content?: unknown
	tool_calls?: Array<{
		id?: string
		type?: string
		function?: {
			name?: string
			arguments?: string
		}
	}>
	tool_call_id?: string
}

export type ChatRequest = {
	model?: string
	messages?: ChatMessage[]
	stream?: boolean
	tools?: ChatToolDefinition[]
	tool_choice?: ChatToolChoice
	temperature?: number
	top_p?: number
	stop?: string | string[]
	max_tokens?: number
	parallel_tool_calls?: boolean
	reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high"
}

export type AnthropicToolDefinition = {
	name?: string
	description?: string
	input_schema?: JsonObject
}

export type AnthropicToolChoice =
	| {
			type?: "auto" | "any" | "none"
	  }
	| {
			type?: "tool"
			name?: string
	  }

export type AnthropicContentBlock =
	| {
			type?: "text"
			text?: string
	  }
	| {
			type?: "image"
			source?: {
				type?: "base64"
				media_type?: string
				data?: string
			}
	  }
	| {
			type?: "tool_use"
			id?: string
			name?: string
			input?: JsonValue
	  }
	| {
			type?: "tool_result"
			tool_use_id?: string
			content?: unknown
			is_error?: boolean
	  }
	| {
			type?: "thinking" | "redacted_thinking"
			thinking?: string
	  }

export type AnthropicMessage = {
	role?: "user" | "assistant"
	content?: string | AnthropicContentBlock[]
}

export type AnthropicMessageRequest = {
	model?: string
	system?: string | Array<{ type?: "text"; text?: string }>
	messages?: AnthropicMessage[]
	max_tokens?: number
	temperature?: number
	top_p?: number
	stream?: boolean
	stop_sequences?: string[]
	tools?: AnthropicToolDefinition[]
	tool_choice?: AnthropicToolChoice
	thinking?: Record<string, unknown>
	effort?: "low" | "medium" | "high" | "xhigh" | "max"
	anthropic_beta?: string[]
	metadata?: {
		user_id?: string
	}
	container?: Record<string, unknown>
	mcp_servers?: Array<Record<string, unknown>>
	context_management?: Record<string, unknown>
	speed?: "fast" | "standard"
	inference_geo?: "us" | "global"
	task_budget?: {
		type?: "tokens"
		total?: number
		remaining?: number
	}
}

export type ChatRequestSummary = {
	bodyKeys: string[]
	messageCount: number
	messageRoles: string[]
	model?: string
	reasoningEffort?: string
	stream: boolean
	toolCount: number
}

type UsageLike = {
	inputTokens?: number
	outputTokens?: number
	totalTokens?: number
	reasoningTokens?: number
	cachedInputTokens?: number
}

export type OpenAIOAuthServerLogEvent =
	| ({
			type: "chat_request"
			requestId: string
			path: "/v1/chat/completions"
	  } & ChatRequestSummary)
	| {
			type: "chat_response"
			durationMs: number
			finishReason?: string
			path: "/v1/chat/completions"
			requestId: string
			status: number
			stream: boolean
			usage: UsageLike
	  }
	| {
			type: "chat_error"
			durationMs: number
			message: string
			path: "/v1/chat/completions"
			requestId: string
	  }
	| ({
			type: "anthropic_request"
			requestId: string
			path: "/v1/messages"
	  } & ChatRequestSummary)
	| {
			type: "anthropic_response"
			durationMs: number
			finishReason?: string
			path: "/v1/messages"
			requestId: string
			status: number
			stream: boolean
			usage: UsageLike
	  }
	| {
			type: "anthropic_error"
			durationMs: number
			message: string
			path: "/v1/messages"
			requestId: string
	  }

export const defaultOpenAIOAuthModels: readonly string[] = [
	"gpt-5.4",
	"gpt-5.3-codex",
	"gpt-5.3-codex-spark",
	"gpt-5.2",
	"gpt-5.1",
	"gpt-5.1-codex",
	"gpt-5.1-codex-max",
]

export type BridgeSourceKind = "codex" | "openai" | "anthropic"
export type OpenAICompatibleApiFormat = "responses" | "chat"
export type ClientApiKeyMode = "fixed" | "bypass"

export type StoredBridgeProfile = {
	name: string
	sourceKind: BridgeSourceKind
	upstreamApiFormat?: OpenAICompatibleApiFormat
	baseURL?: string
	authFilePath?: string
	apiKey?: string
	apiKeyEnvVar?: string
	authToken?: string
	authTokenEnvVar?: string
	exposedApiKey?: string
	clientApiKeyMode?: ClientApiKeyMode
	clientId?: string
	tokenUrl?: string
	codexVersion?: string
	models?: string[]
	defaultModel?: string
	host?: string
	port?: number
	headers?: Record<string, string>
}

export type BridgeProfileStore = {
	version: 1
	defaultProfile?: string
	profiles: Record<string, StoredBridgeProfile>
}

export type OpenAIOAuthServerOptions = Omit<
	CodexOAuthSettings,
	"responsesState"
> & {
	host?: string
	port?: number
	models?: string[]
	codexVersion?: string
	sourceKind?: BridgeSourceKind
	upstreamApiFormat?: OpenAICompatibleApiFormat
	defaultModel?: string
	apiKey?: string
	apiKeyEnvVar?: string
	authToken?: string
	authTokenEnvVar?: string
	exposedApiKey?: string
	clientApiKeyMode?: ClientApiKeyMode
	requestLogger?: (event: OpenAIOAuthServerLogEvent) => void
}

export type BridgeModelFactory = (modelId: string) => LanguageModelV3

export type BridgeRuntime = {
	sourceKind: BridgeSourceKind
	upstreamApiFormat?: OpenAICompatibleApiFormat
	modelFactory: BridgeModelFactory
	resolveModels: () => Promise<string[]>
	defaultModel: string
	supportsOpenAIResponses: boolean
	requestOpenAIResponses?: (
		body: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<Response>
	requestChatCompletion?: (body: ChatRequest) => Promise<Response>
}

export type RunningOpenAIOAuthServer = {
	server: HttpServer
	host: string
	port: number
	url: string
	close: () => Promise<void>
}

export type ChatCompletionResultShape = {
	text: string
	finishReason: string
	toolCalls: Array<{
		toolCallId: string
		toolName: string
		input: unknown
	}>
	usage: UsageLike
}

export type { UsageLike }
