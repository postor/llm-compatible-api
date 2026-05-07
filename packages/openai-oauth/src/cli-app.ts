import { access } from "node:fs/promises"
import os from "node:os"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { resolveAuthFileCandidates } from "../../openai-oauth-core/src/index.js"
import packageJson from "../package.json" with { type: "json" }
import { installCliWarningLogger, toStartupMessage } from "./cli-logging.js"
import { collectProfileInteractively } from "./interactive.js"
import {
	getStoredProfile,
	readProfileStore,
	removeProfile,
	resolveProfileStorePath,
	saveProfile,
	setDefaultProfile,
} from "./profile-store.js"
import { createBridgeRuntime } from "./runtime.js"
import { DEFAULT_PORT } from "./shared.js"
import { startOpenAIOAuthServer } from "./index.js"
import { checkForOpenAIOAuthUpdates } from "./update-check.js"
import type { OpenAIOAuthServerOptions, StoredBridgeProfile } from "./types.js"

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
	defaultModel?: string
	profileName?: string
	apiKey?: string
	apiKeyEnvVar?: string
	authToken?: string
	authTokenEnvVar?: string
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

const parseHeaders = (values: string[] | undefined): Record<string, string> | undefined => {
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
	"  --oauth-file <path>        Auth file path for codex/openai sources.",
	"  --api-key <value>          Explicit API key for openai/anthropic sources.",
	"  --api-key-env <name>       Env var name that contains the API key.",
	"  --auth-token <value>       Explicit bearer token for anthropic sources.",
	"  --auth-token-env <name>    Env var name that contains the bearer token.",
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

	return {
		host: parsed.host,
		port: parsed.port,
		models: parsed.models,
		codexVersion: parsed.codexVersion,
		baseURL: parsed.baseUrl,
		clientId: parsed.oauthClientId,
		tokenUrl: parsed.oauthTokenUrl,
		authFilePath: expandUserHome(parsed.oauthFile),
		sourceKind:
			parsed.source === "codex" ||
			parsed.source === "openai" ||
			parsed.source === "anthropic"
				? parsed.source
				: undefined,
		defaultModel: parsed.defaultModel,
		profileName: parsed.profile,
		apiKey: parsed.apiKey,
		apiKeyEnvVar: parsed.apiKeyEnv,
		authToken: parsed.authToken,
		authTokenEnvVar: parsed.authTokenEnv,
		headers: parseHeaders(parsed.header),
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
	defaultModel: args.defaultModel,
	apiKey: args.apiKey,
	apiKeyEnvVar: args.apiKeyEnvVar,
	authToken: args.authToken,
	authTokenEnvVar: args.authTokenEnvVar,
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
		defaultModel: args.defaultModel ?? profile.defaultModel,
		profileName: args.profileName ?? profile.name,
		apiKey: args.apiKey ?? profile.apiKey,
		apiKeyEnvVar: args.apiKeyEnvVar ?? profile.apiKeyEnvVar,
		authToken: args.authToken ?? profile.authToken,
		authTokenEnvVar: args.authTokenEnvVar ?? profile.authTokenEnvVar,
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
			args.headers,
	)

const toStoredProfile = (
	name: string,
	args: CliArgs,
): StoredBridgeProfile => ({
	name,
	sourceKind: args.sourceKind ?? "openai",
	baseURL: args.baseURL,
	authFilePath: args.authFilePath,
	apiKey: args.apiKey,
	apiKeyEnvVar: args.apiKeyEnvVar,
	authToken: args.authToken,
	authTokenEnvVar: args.authTokenEnvVar,
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
	const availableModels = await runtime.resolveModels()
	const server = await startOpenAIOAuthServer(options)

	console.log(
		toStartupMessage(
			`http://${server.host}:${server.port}/v1`,
			availableModels,
			{
				useColor: process.stdout.isTTY,
				sourceKind: options.sourceKind,
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
	const profile = await collectProfileInteractively(await getStoredProfile())
	await saveProfile(profile, { setDefault: true })
	console.log(`Saved default profile "${profile.name}" at ${resolveProfileStorePath()}`)
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
			await saveProfile(toStoredProfile(args.name!, args), {
				setDefault: args.setDefault,
			})
			console.log(`Saved profile "${args.name}".`)
			return
		}

		default:
			throw new Error(
				"Usage: profiles <list|show|add|use|remove> [args]",
			)
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
