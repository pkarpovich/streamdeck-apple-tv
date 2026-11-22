import { describe, expect, it } from "vitest";

import { parseSettings, settingsIdentity, type SettingName } from "./settings.js";
import { settings } from "./testing.js";

const names: SettingName[] = ["serverUrl", "issuer", "tokenEndpoint", "clientId", "keyId", "keyFile", "scope"];

describe("parseSettings", () => {
	it("accepts complete settings", () => {
		expect(parseSettings({ ...settings, extra: true })).toEqual({ ok: true, settings });
	});

	it("trims values", () => {
		expect(parseSettings({ ...settings, clientId: "  streamdeck-apple-tv\n" })).toEqual({ ok: true, settings });
	});

	it.each(names)("refuses a missing %s", (name) => {
		const raw: Record<string, unknown> = { ...settings };
		delete raw[name];
		expect(parseSettings(raw)).toEqual({ ok: false, problems: [`${name} is missing`] });
	});

	it.each(names)("refuses an empty %s", (name) => {
		expect(parseSettings({ ...settings, [name]: "   " })).toEqual({ ok: false, problems: [`${name} is missing`] });
	});

	it.each(names)("refuses a %s that is not a string", (name) => {
		expect(parseSettings({ ...settings, [name]: 42 })).toEqual({ ok: false, problems: [`${name} is missing`] });
	});

	it.each(["serverUrl", "issuer", "tokenEndpoint"] as const)("refuses a non-https %s", (name) => {
		for (const value of ["http://example.com/mcp", "ftp://example.com", "example.com", "file:///etc/passwd"]) {
			expect(parseSettings({ ...settings, [name]: value })).toEqual({
				ok: false,
				problems: [`${name} must be an https URL`],
			});
		}
	});

	it("refuses a relative keyFile", () => {
		expect(parseSettings({ ...settings, keyFile: "keys/client.pem" })).toEqual({
			ok: false,
			problems: ["keyFile must be an absolute path"],
		});
	});

	it("lists every problem when nothing is set", () => {
		for (const raw of [undefined, null, "settings", [], {}]) {
			expect(parseSettings(raw)).toEqual({ ok: false, problems: names.map((name) => `${name} is missing`) });
		}
	});
});

describe("settingsIdentity", () => {
	it.each(names)("changes when %s changes", (name) => {
		expect(settingsIdentity({ ...settings, [name]: `${settings[name]}x` })).not.toBe(settingsIdentity(settings));
	});
});
