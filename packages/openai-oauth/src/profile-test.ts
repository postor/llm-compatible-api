import { generateText } from "ai"
import type { BridgeRuntime } from "./types.js"

export type ProfileHelloTestResult = {
	model: string
	text: string
}

export const testProfileWithHello = async (
	runtime: BridgeRuntime,
	preferredModel?: string,
): Promise<ProfileHelloTestResult> => {
	const models = await runtime.resolveModels()
	const model = preferredModel ?? models[0]
	if (!model) {
		throw new Error("Profile test could not resolve a model from upstream.")
	}
	if (runtime.upstreamApiFormat === "chat" && runtime.requestChatCompletion) {
		const response = await runtime.requestChatCompletion({
			model,
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 64,
		})
		const text = await response.text()
		if (!response.ok) {
			throw new Error(text || "Chat Completions hello test failed.")
		}

		const parsed = JSON.parse(text) as {
			choices?: Array<{ message?: { content?: unknown } }>
		}
		const content = parsed.choices?.[0]?.message?.content
		if (typeof content !== "string" || content.length === 0) {
			throw new Error("Chat Completions hello test returned no text.")
		}

		return {
			model,
			text: content.trim(),
		}
	}

	const result = await generateText({
		model: runtime.modelFactory(model),
		messages: [{ role: "user", content: "hello" }],
		maxOutputTokens: 64,
		maxRetries: 0,
	})

	return {
		model,
		text: result.text.trim(),
	}
}
