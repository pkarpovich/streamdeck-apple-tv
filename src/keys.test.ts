import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pluginId, remoteKeys } from "./keys.js";

const pluginFolder = new URL("../com.pavel-karpovich.apple-tv.sdPlugin/", import.meta.url);

interface ManifestAction {
	readonly UUID: string;
	readonly Icon: string;
	readonly Controllers: readonly string[];
	readonly States: readonly { readonly Image: string }[];
}

interface Manifest {
	readonly UUID: string;
	readonly PropertyInspectorPath: string;
	readonly Actions: readonly ManifestAction[];
}

const manifest: Manifest = JSON.parse(readFileSync(new URL("manifest.json", pluginFolder), "utf8"));

describe("manifest", () => {
	it("declares the plugin UUID", () => {
		expect(manifest.UUID).toBe(pluginId);
	});

	it("declares one keypad action with one state for every remote key", () => {
		expect(manifest.Actions.map((action) => action.UUID)).toEqual(remoteKeys.map((key) => key.action));
		for (const action of manifest.Actions) {
			expect(action.Controllers).toEqual(["Keypad"]);
			expect(action.States).toHaveLength(1);
		}
	});

	it("points to files that exist", () => {
		expect(existsSync(new URL(manifest.PropertyInspectorPath, pluginFolder))).toBe(true);
		for (const action of manifest.Actions) {
			expect(existsSync(new URL(`${action.Icon}.svg`, pluginFolder))).toBe(true);
			for (const state of action.States) {
				expect(existsSync(new URL(`${state.Image}.svg`, pluginFolder))).toBe(true);
			}
		}
	});
});
