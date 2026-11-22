import { isAbsolute } from "node:path";

import { isRecord } from "./http.js";

export interface Settings {
	readonly serverUrl: string;
	readonly issuer: string;
	readonly tokenEndpoint: string;
	readonly clientId: string;
	readonly keyId: string;
	readonly keyFile: string;
	readonly scope: string;
}

export type SettingName = keyof Settings;

export type SettingsResult =
	{ readonly ok: true; readonly settings: Settings } | { readonly ok: false; readonly problems: readonly string[] };

const httpsSettings: ReadonlySet<SettingName> = new Set(["serverUrl", "issuer", "tokenEndpoint"]);

export function parseSettings(raw: unknown): SettingsResult {
	const source = isRecord(raw) ? raw : {};
	const problems: string[] = [];
	const read = (name: SettingName): string => {
		const value = source[name];
		if (typeof value !== "string" || value.trim() === "") {
			problems.push(`${name} is missing`);
			return "";
		}
		const trimmed = value.trim();
		const problem = invalidity(name, trimmed);
		if (problem !== undefined) {
			problems.push(`${name} ${problem}`);
		}
		return trimmed;
	};
	const settings: Settings = {
		serverUrl: read("serverUrl"),
		issuer: read("issuer"),
		tokenEndpoint: read("tokenEndpoint"),
		clientId: read("clientId"),
		keyId: read("keyId"),
		keyFile: read("keyFile"),
		scope: read("scope"),
	};
	if (problems.length > 0) {
		return { ok: false, problems };
	}
	return { ok: true, settings };
}

export function settingsIdentity(settings: Settings): string {
	return JSON.stringify([
		settings.serverUrl,
		settings.issuer,
		settings.tokenEndpoint,
		settings.clientId,
		settings.keyId,
		settings.keyFile,
		settings.scope,
	]);
}

function invalidity(name: SettingName, value: string): string | undefined {
	if (httpsSettings.has(name) && URL.parse(value)?.protocol !== "https:") {
		return "must be an https URL";
	}
	if (name === "keyFile" && !isAbsolute(value)) {
		return "must be an absolute path";
	}
	return undefined;
}
