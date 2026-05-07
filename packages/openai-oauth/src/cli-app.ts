import { access } from "node:fs/promises"
import os from "node:os"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { resolveAuthFileCandidates } from "../../openai-oauth-core/src/index.js"
import packageJson from "../package.json" with { type: "json" }
import { installCliWarningLogger, toStartupMessage } from "./cli-logging.js"
import { startOpenAIOAuthServer } from "./index.js"
import {
	collectInitInteractively,
	collectProfileInteractively,
} from "./interactive.js"
import {
	getStoredProfile,
	readProfileStore,
	removeProfile,
	resolveProfileStorePath,
	saveProfile,
	setDefaultProfile,
} from "./profile-store.js"
import { testProfileWithHello } from "./profile-test.js"
import {
	ANTHROPIC_OFFICIAL_BASE_URL,
	createBridgeRuntime,
	OPENAI_DEFAULT_BASE_URL,
} from "./runtime.js"
import { DEFAULT_PORT } from "./shared.js"
import type { OpenAIOAuthServerOptions, StoredBridgeProfile } from "./types.js"
import { checkForOpenAIOAuthUpdates } from "./update-check.js"

export type CliArgs = {
	host?: string
	port?: number
	models?: string[]
	codexVersion?: string
	baseURL?: string
	clientId?: string
	tokenUrl?: string
	authFilePath?: string
	sourceKind?: "codex" | "openai" | "anthropic"
	upstreamApiFormat?: "responses" | "chat"
	defaultModel?: string
	profileName?: string
	apiKey?: string
	apiKeyEnvVar?: string
	authToken?: string
	authTokenEnvVar?: string
	exposedApiKey?: string
	clientApiKeyMode?: "fixed" | "bypass"
	headers?: Record<string, string>
}

type ProfileSaveArgs = CliArgs & {
	name?: string
	setDefault?: boolean
}

const parseModels = (value: string | undefined): string[] | undefined => {
	if (typeof value !== "string") {
		return undefined
	}

	const models = value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)

	return models.length > 0 ? models : undefined
}

const parsePort = (value: string | undefined): number | undefined => {
	if (typeof value !== "string" || value.trim().length === 0) {
		return undefined
	}

	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : undefined
}

const parseHeaders = (
	values: string[] | undefined,
): Record<string, string> | undefined => {
	if (!Array.isArray(values) || values.length === 0) {
		return undefined
	}

	const headers: Record<string, string> = {}
	for (const value of values) {
		const [rawKey, ...rest] = value.split("=")
		const key = rawKey?.trim()
		const headerValue = rest.join("=").trim()
		if (key && headerValue) {
			headers[key] = headerValue
		}
	}

	return Object.keys(headers).length > 0 ? headers : undefined
}

const parseHeaderList = (value: string | undefined): string[] | undefined => {
	if (typeof value !== "string" || value.trim().length === 0) {
		return undefined
	}

	const headers = value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
	return headers.length > 0 ? headers : undefined
}

const parseSourceKind = (value: string | undefined): CliArgs["sourceKind"] => {
	if (value === "codex" || value === "openai" || value === "anthropic") {
		return value
	}

	return undefined
}

const parseUpstreamApiFormat = (
	value: string | undefined,
): CliArgs["upstreamApiFormat"] => {
	if (value === "responses" || value === "chat") {
		return value
	}

	return undefined
}

const parseClientApiKeyMode = (
	value: string | undefined,
): CliArgs["clientApiKeyMode"] => {
	if (value === "fixed" || value === "bypass") {
		return value
	}

	return undefined
}

const readDirectStartEnv = (): Partial<CliArgs> => {
	const sourceKind = parseSourceKind(process.env.LLM_COMPATIBLE_API_SOURCE)
	const apiKey = process.env.LLM_COMPATIBLE_API_API_KEY
	const clientApiKeyMode = parseClientApiKeyMode(
		process.env.LLM_COMPATIBLE_API_CLIENT_API_KEY_MODE,
	)

	if (!sourceKind || (!apiKey && clientApiKeyMode !== "bypass")) {
		return {}
	}

	const defaultBaseURL =
		sourceKind === "anthropic"
			? ANTHROPIC_OFFICIAL_BASE_URL
			: sourceKind === "openai"
				? OPENAI_DEFAULT_BASE_URL
				: undefined

	return {
		sourceKind,
		baseURL: process.env.LLM_COMPATIBLE_API_BASE_URL ?? defaultBaseURL,
		apiKey,
		host: process.env.LLM_COMPATIBLE_API_HOST,
		port: parsePort(process.env.LLM_COMPATIBLE_API_PORT),
		models: parseModels(process.env.LLM_COMPATIBLE_API_MODELS),
		defaultModel: process.env.LLM_COMPATIBLE_API_DEFAULT_MODEL,
		exposedApiKey: process.env.LLM_COMPATIBLE_API_EXPOSED_API_KEY,
		clientApiKeyMode,
		upstreamApiFormat:
			sourceKind === "openai"
				? (parseUpstreamApiFormat(
						process.env.LLM_COMPATIBLE_API_UPSTREAM_API_FORMAT,
					) ?? "chat")
				: undefined,
		headers: parseHeaders(
			parseHeaderList(process.env.LLM_COMPATIBLE_API_HEADERS),
		),
	}
}

const expandUserHome = (value: string | undefined): string | undefined => {
	if (typeof value !== "string" || value.length === 0) {
		return undefined
	}

	return value.startsWith("~/") ? `${os.homedir()}${value.slice(1)}` : value
}

const helpLines = [
	"Bridge one active upstream source into local OpenAI and Anthropic compatible endpoints.",
	"",
	"Usage",
	"  npx llm-compatible-api@latest [serve options]",
	"  npx llm-compatible-api@latest serve [options]",
	"  npx llm-compatible-api@latest init",
	"  npx llm-compatible-api@latest profiles <list|show|add|use|remove>",
	"",
	"Serve Options",
	"  --source <kind>            Source kind: codex, openai, anthropic.",
	"  --base-url <url>           Override the upstream base URL.",
	"  --upstream-api-format <f>  OpenAI-compatible upstream format: responses or chat.",
	"  --oauth-file <path>        Auth file path for codex/openai sources.",
	"  --api-key <value>          Explicit API key for openai/anthropic sources.",
	"  --api-key-env <name>       Env var name that contains the API key.",
	"  --auth-token <value>       Explicit bearer token for anthropic sources.",
	"  --auth-token-env <name>    Env var name that contains the bearer token.",
	"  --exposed-api-key <value>  Require this API key from local proxy clients.",
	"  --client-api-key-mode <m>  Client key mode: fixed or bypass.",
	"  --header k=v              Repeatable upstream header override.",
	"  --profile <name>           Load a saved profile.",
	"  --host <host>              Host interface to bind to.",
	"  --port <port>              Port to listen on. Default: 10531",
	"  --models <ids>             Comma-separated model ids to expose from /v1/models.",
	"  --default-model <id>       Default model when the client omits one.",
	"",
	"Flags",
	"  --help                     Show help",
	`  --version                  Show version (${packageJson.version})`,
]

const createServeCliParser = (argv: string[]) =>
	yargs(argv)
		.scriptName("llm-compatible-api")
		.strict()
		.help(false)
		.version(false)
		.option("host", { type: "string" })
		.option("port", { type: "number" })
		.option("models", {
			type: "string",
			coerce: parseModels,
		})
		.option("codex-version", { type: "string" })
		.option("base-url", { type: "string" })
		.option("upstream-api-format", {
			type: "string",
			choices: ["responses", "chat"],
		})
		.option("oauth-client-id", { type: "string" })
		.option("oauth-token-url", { type: "string" })
		.option("oauth-file", { type: "string" })
		.option("source", {
			type: "string",
			choices: ["codex", "openai", "anthropic"],
		})
		.option("default-model", { type: "string" })
		.option("profile", { type: "string" })
		.option("api-key", { type: "string" })
		.option("api-key-env", { type: "string" })
		.option("auth-token", { type: "string" })
		.option("auth-token-env", { type: "string" })
		.option("exposed-api-key", { type: "string" })
		.option("client-api-key-mode", {
			type: "string",
			choices: ["fixed", "bypass"],
		})
		.option("header", {
			type: "string",
			array: true,
		})

const isHelpFlag = (argv: string[]): boolean =>
	argv.includes("--help") || argv.includes("-h")

const isVersionFlag = (argv: string[]): boolean => argv.includes("--version")

export const toHelpMessage = (): string => helpLines.join("\n")

export const parseCliArgs = (argv: string[]): CliArgs => {
	const parsed = createServeCliParser(argv).parseSync()
	const directStartEnv = readDirectStartEnv()
	const cliHeaders = parseHeaders(parsed.header)

	return {
		host: parsed.host ?? directStartEnv.host,
		port: parsed.port ?? directStartEnv.port,
		models: parsed.models ?? directStartEnv.models,
		codexVersion: parsed.codexVersion,
		baseURL: parsed.baseUrl ?? directStartEnv.baseURL,
		clientId: parsed.oauthClientId,
		tokenUrl: parsed.oauthTokenUrl,
		authFilePath: expandUserHome(parsed.oauthFile),
		sourceKind: parseSourceKind(parsed.source) ?? directStartEnv.sourceKind,
		upstreamApiFormat:
			parseUpstreamApiFormat(parsed.upstreamApiFormat) ??
			directStartEnv.upstreamApiFormat,
		defaultModel: parsed.defaultModel ?? directStartEnv.defaultModel,
		profileName: parsed.profile,
		apiKey: parsed.apiKey ?? directStartEnv.apiKey,
		apiKeyEnvVar: parsed.apiKeyEnv,
		authToken: parsed.authToken,
		authTokenEnvVar: parsed.authTokenEnv,
		exposedApiKey: parsed.exposedApiKey ?? directStartEnv.exposedApiKey,
		clientApiKeyMode:
			parseClientApiKeyMode(parsed.clientApiKeyMode) ??
			directStartEnv.clientApiKeyMode,
		headers:
			directStartEnv.headers || cliHeaders
				? {
						...(directStartEnv.headers ?? {}),
						...(cliHeaders ?? {}),
					}
				: undefined,
	}
}

export const toServerOptions = (
	args: CliArgs | StoredBridgeProfile,
): OpenAIOAuthServerOptions => ({
	host: args.host,
	port: args.port ?? DEFAULT_PORT,
	models: args.models,
	codexVersion: args.codexVersion,
	baseURL: args.baseURL,
	clientId: args.clientId,
	tokenUrl: args.tokenUrl,
	authFilePath: expandUserHome(args.authFilePath),
	sourceKind: args.sourceKind,
	upstreamApiFormat: args.upstreamApiFormat,
	defaultModel: args.defaultModel,
	apiKey: args.apiKey,
	apiKeyEnvVar: args.apiKeyEnvVar,
	authToken: args.authToken,
	authTokenEnvVar: args.authTokenEnvVar,
	exposedApiKey: args.exposedApiKey,
	clientApiKeyMode: args.clientApiKeyMode,
	headers: args.headers,
})

const mergeProfileWithArgs = (
	profile: StoredBridgeProfile | undefined,
	args: CliArgs,
): CliArgs => {
	if (!profile) {
		return args
	}

	return {
		host: args.host ?? profile.host,
		port: args.port ?? profile.port,
		models: args.models ?? profile.models,
		codexVersion: args.codexVersion ?? profile.codexVersion,
		baseURL: args.baseURL ?? profile.baseURL,
		clientId: args.clientId ?? profile.clientId,
		tokenUrl: args.tokenUrl ?? profile.tokenUrl,
		authFilePath: args.authFilePath ?? profile.authFilePath,
		sourceKind: args.sourceKind ?? profile.sourceKind,
		upstreamApiFormat: args.upstreamApiFormat ?? profile.upstreamApiFormat,
		defaultModel: args.defaultModel ?? profile.defaultModel,
		profileName: args.profileName ?? profile.name,
		apiKey: args.apiKey ?? profile.apiKey,
		apiKeyEnvVar: args.apiKeyEnvVar ?? profile.apiKeyEnvVar,
		authToken: args.authToken ?? profile.authToken,
		authTokenEnvVar: args.authTokenEnvVar ?? profile.authTokenEnvVar,
		exposedApiKey: args.exposedApiKey ?? profile.exposedApiKey,
		clientApiKeyMode: args.clientApiKeyMode ?? profile.clientApiKeyMode,
		headers: {
			...(profile.headers ?? {}),
			...(args.headers ?? {}),
		},
	}
}

const findExistingAuthFile = async (
	authFilePath: string | undefined,
): Promise<string | undefined> => {
	for (const candidate of resolveAuthFileCandidates(authFilePath)) {
		try {
			await access(candidate)
			return candidate
		} catch {}
	}

	return undefined
}

const hasConfiguredSecret = (args: CliArgs): boolean => {
	if (args.clientApiKeyMode === "bypass") {
		return true
	}

	const openAiEnv =
		args.apiKeyEnvVar && args.apiKeyEnvVar.length > 0
			? process.env[args.apiKeyEnvVar]
			: process.env.OPENAI_API_KEY
	const anthropicKeyEnv =
		args.apiKeyEnvVar && args.apiKeyEnvVar.length > 0
			? process.env[args.apiKeyEnvVar]
			: process.env.ANTHROPIC_API_KEY
	const anthropicTokenEnv =
		args.authTokenEnvVar && args.authTokenEnvVar.length > 0
			? process.env[args.authTokenEnvVar]
			: process.env.ANTHROPIC_AUTH_TOKEN

	return Boolean(
		(args.apiKey && args.apiKey.length > 0) ||
			(args.authToken && args.authToken.length > 0) ||
			openAiEnv ||
			anthropicKeyEnv ||
			anthropicTokenEnv,
	)
}

const toMissingAuthFileMessage = (authFilePath: string | undefined): string => {
	if (authFilePath) {
		return [
			`No auth file was found at ${authFilePath}.`,
			"Run `npx @openai/codex login`, or set an API key env var, and try again.",
		].join("\n")
	}

	const candidates = resolveAuthFileCandidates(undefined)
	return [
		`No auth file was found in the default search paths: ${candidates.join(", ")}.`,
		"Run `npx @openai/codex login`, or set an API key env var, and try again.",
	].join("\n")
}

const hasExplicitServeOptions = (args: CliArgs): boolean =>
	Boolean(
		args.host ||
			args.port ||
			args.models ||
			args.codexVersion ||
			args.baseURL ||
			args.clientId ||
			args.tokenUrl ||
			args.authFilePath ||
			args.sourceKind ||
			args.defaultModel ||
			args.profileName ||
			args.apiKey ||
			args.apiKeyEnvVar ||
			args.authToken ||
			args.authTokenEnvVar ||
			args.exposedApiKey ||
			args.clientApiKeyMode ||
			args.headers,
	)

const toStoredProfile = (name: string, args: CliArgs): StoredBridgeProfile => ({
	name,
	sourceKind: args.sourceKind ?? "openai",
	upstreamApiFormat: args.upstreamApiFormat,
	baseURL: args.baseURL,
	authFilePath: args.authFilePath,
	apiKey: args.apiKey,
	apiKeyEnvVar: args.apiKeyEnvVar,
	authToken: args.authToken,
	authTokenEnvVar: args.authTokenEnvVar,
	exposedApiKey: args.exposedApiKey,
	clientApiKeyMode: args.clientApiKeyMode,
	clientId: args.clientId,
	tokenUrl: args.tokenUrl,
	codexVersion: args.codexVersion,
	models: args.models,
	defaultModel: args.defaultModel,
	host: args.host,
	port: args.port,
	headers: args.headers,
})

const maskProfile = (profile: StoredBridgeProfile) => ({
	...profile,
	apiKey: profile.apiKey ? "***" : undefined,
	authToken: profile.authToken ? "***" : undefined,
	exposedApiKey: profile.exposedApiKey ? "***" : undefined,
})

const resolveServeArgs = async (argv: string[]): Promise<CliArgs> => {
	const parsed = parseCliArgs(argv)
	const storedProfile =
		parsed.profileName != null
			? await getStoredProfile(parsed.profileName)
			: !hasExplicitServeOptions(parsed)
				? await getStoredProfile()
				: undefined

	if (parsed.profileName && !storedProfile) {
		throw new Error(`Profile not found: ${parsed.profileName}`)
	}

	if (!hasExplicitServeOptions(parsed) && !storedProfile) {
		const profile = await collectProfileInteractively()
		await saveProfile(profile, { setDefault: true })
		return profile
	}

	return mergeProfileWithArgs(storedProfile, parsed)
}

const resolveStartupModels = async (
	options: OpenAIOAuthServerOptions,
	runtime: ReturnType<typeof createBridgeRuntime>,
): Promise<string[]> => {
	if (options.clientApiKeyMode === "bypass") {
		return options.models?.length ? options.models : [runtime.defaultModel]
	}

	return runtime.resolveModels()
}

const runServeCommand = async (argv: string[]) => {
	if (isHelpFlag(argv)) {
		console.log(toHelpMessage())
		return
	}

	if (isVersionFlag(argv)) {
		console.log(packageJson.version)
		return
	}

	installCliWarningLogger()

	const resolvedArgs = await resolveServeArgs(argv)
	const options = toServerOptions(resolvedArgs)

	if (options.sourceKind !== "anthropic") {
		const existingAuthFile = await findExistingAuthFile(options.authFilePath)
		if (!existingAuthFile && !hasConfiguredSecret(resolvedArgs)) {
			throw new Error(toMissingAuthFileMessage(options.authFilePath))
		}
	}

	const runtime = createBridgeRuntime(options)
	const availableModels = await resolveStartupModels(options, runtime)
	const server = await startOpenAIOAuthServer(options)

	console.log(
		toStartupMessage(
			`http://${server.host}:${server.port}/v1`,
			availableModels,
			{
				useColor: process.stdout.isTTY,
				sourceKind: options.sourceKind,
				requiresClientApiKey: Boolean(
					options.exposedApiKey || options.clientApiKeyMode === "bypass",
				),
			},
		),
	)

	void checkForOpenAIOAuthUpdates(packageJson.version, {
		onWarning: (message) => {
			console.error(message)
		},
	})

	const shutdown = async () => {
		await server.close()
		process.exit(0)
	}

	process.once("SIGINT", shutdown)
	process.once("SIGTERM", shutdown)
}

const runInitCommand = async () => {
	const { action, profile } = await collectInitInteractively(
		await getStoredProfile(),
	)
	await saveProfile(profile, { setDefault: true })
	console.log(
		`Saved default profile "${profile.name}" at ${resolveProfileStorePath()}`,
	)
	if (action === "end") {
		return
	}

	if (profile.clientApiKeyMode === "bypass") {
		console.log(
			"Bypass mode has no saved source/client key, so init cannot run the profile test. Start the server and test with a client Authorization bearer key instead.",
		)
		return
	}

	try {
		const runtime = createBridgeRuntime(toServerOptions(profile))
		console.log(
			`Testing profile with hello against ${profile.baseURL ?? "default upstream"} (${profile.upstreamApiFormat ?? profile.sourceKind})...`,
		)
		const result = await testProfileWithHello(runtime, profile.defaultModel)
		console.log(`Profile test passed with model "${result.model}".`)
		console.log(`Assistant response: ${result.text}`)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`Profile test failed: ${message}`)
	}
}

const runProfilesCommand = async (argv: string[]) => {
	const [subcommand, ...rest] = argv

	switch (subcommand) {
		case "list": {
			const store = await readProfileStore()
			const names = Object.keys(store.profiles)
			if (names.length === 0) {
				console.log("No saved profiles.")
				return
			}

			for (const name of names.sort()) {
				const marker = store.defaultProfile === name ? "*" : " "
				const profile = store.profiles[name]
				console.log(
					`${marker} ${name}  source=${profile?.sourceKind ?? "openai"}  baseURL=${profile?.baseURL ?? ""}`,
				)
			}
			return
		}

		case "show": {
			const profile = await getStoredProfile(rest[0])
			if (!profile) {
				throw new Error(
					rest[0] ? `Profile not found: ${rest[0]}` : "No default profile set.",
				)
			}
			console.log(JSON.stringify(maskProfile(profile), null, 2))
			return
		}

		case "use": {
			const name = rest[0]
			if (!name) {
				throw new Error("Usage: profiles use <name>")
			}
			if (!(await setDefaultProfile(name))) {
				throw new Error(`Profile not found: ${name}`)
			}
			console.log(`Default profile set to "${name}".`)
			return
		}

		case "remove": {
			const name = rest[0]
			if (!name) {
				throw new Error("Usage: profiles remove <name>")
			}
			if (!(await removeProfile(name))) {
				throw new Error(`Profile not found: ${name}`)
			}
			console.log(`Removed profile "${name}".`)
			return
		}

		case "add": {
			const interactive = rest.includes("--interactive") || rest.length === 0
			if (interactive) {
				const profile = await collectProfileInteractively()
				await saveProfile(profile, {
					setDefault: rest.includes("--default"),
				})
				console.log(`Saved profile "${profile.name}".`)
				return
			}

			const parser = createServeCliParser(rest)
				.option("name", { type: "string", demandOption: true })
				.option("default", { type: "boolean", default: false })
			const parsed = parser.parseSync()
			const args: ProfileSaveArgs = {
				...parseCliArgs(rest),
				name: parsed.name,
				setDefault: parsed.default,
			}
			if (!args.name) {
				throw new Error("Usage: profiles add --name <name>")
			}
			await saveProfile(toStoredProfile(args.name, args), {
				setDefault: args.setDefault,
			})
			console.log(`Saved profile "${args.name}".`)
			return
		}

		default:
			throw new Error("Usage: profiles <list|show|add|use|remove> [args]")
	}
}

export const runCli = async (argv: string[] = hideBin(process.argv)) => {
	const [command, ...rest] = argv

	if (command === "init") {
		await runInitCommand()
		return
	}

	if (command === "profiles") {
		await runProfilesCommand(rest)
		return
	}

	if (command === "serve") {
		await runServeCommand(rest)
		return
	}

	await runServeCommand(argv)
}

export { toMissingAuthFileMessage }
