import type { RemoteKey } from "./keys.js";
import { parseSettings } from "./settings.js";
import { TokenError, type TokenSource } from "./token.js";
import { callTool } from "./tool-call.js";

export interface PressDependencies {
	readonly tokens: Pick<TokenSource, "get" | "drop">;
	readonly fetch: typeof fetch;
	readonly log: (message: string) => void;
}

export async function press(deps: PressDependencies, key: RemoteKey, rawSettings: unknown): Promise<boolean> {
	const parsed = parseSettings(rawSettings);
	if (!parsed.ok) {
		deps.log(`${key.action}: invalid settings: ${parsed.problems.join(", ")}`);
		return false;
	}
	let accessToken: string;
	try {
		accessToken = await deps.tokens.get(parsed.settings);
	} catch (error) {
		deps.log(`${key.action}: ${error instanceof TokenError ? error.message : "token request failed"}`);
		return false;
	}
	const result = await callTool(deps.fetch, parsed.settings.serverUrl, accessToken, key.call);
	if (result.ok) {
		return true;
	}
	if (result.unauthorized) {
		deps.tokens.drop();
	}
	deps.log(`${key.action}: tool call failed: ${result.reason}`);
	return false;
}
