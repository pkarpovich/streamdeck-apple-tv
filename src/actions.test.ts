import { beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteKeyAction } from "./actions.js";
import { remoteKeys, type RemoteKey } from "./keys.js";
import { fakeFetch, jsonResponse, settings } from "./testing.js";

const sdk = vi.hoisted(() => ({ globalSettings: {} as unknown, failure: undefined as Error | undefined }));

vi.mock("@elgato/streamdeck", () => ({
	default: {
		settings: {
			getGlobalSettings: async () => {
				if (sdk.failure !== undefined) {
					throw sdk.failure;
				}
				return sdk.globalSettings;
			},
		},
	},
	SingletonAction: class {},
}));

const [up = fail()] = remoteKeys;

function fail(): RemoteKey {
	throw new Error("no keys");
}

function keyPress() {
	const alerts: string[] = [];
	return {
		alerts,
		event: {
			action: {
				showAlert: async () => {
					alerts.push("alert");
				},
			},
		},
	};
}

function action(tool: () => Response, token: () => Promise<string> = async () => "access-1") {
	const network = fakeFetch(tool);
	const logs: string[] = [];
	const deps = {
		tokens: { get: token, drop: () => undefined },
		fetch: network.fetch,
		log: (line: string) => logs.push(line),
	};
	return { remoteKey: new RemoteKeyAction(up, deps), calls: network.calls, logs };
}

describe("RemoteKeyAction", () => {
	beforeEach(() => {
		sdk.globalSettings = settings;
		sdk.failure = undefined;
	});

	it("shows the alert and logs one line when reading the settings fails", async () => {
		sdk.failure = new Error("connection closed\nby Stream Deck");
		const { remoteKey, calls, logs } = action(() => jsonResponse(200, {}));
		const { alerts, event } = keyPress();

		await remoteKey.onKeyDown(event);

		expect(calls).toHaveLength(0);
		expect(alerts).toEqual(["alert"]);
		expect(logs).toEqual(["com.pavel-karpovich.apple-tv.up: key press failed: connection closed by Stream Deck"]);
	});

	it("binds to the action UUID", () => {
		expect(action(() => jsonResponse(200, {})).remoteKey.manifestId).toBe("com.pavel-karpovich.apple-tv.up");
	});

	it("shows nothing on success", async () => {
		const { remoteKey, calls } = action(() => jsonResponse(200, { jsonrpc: "2.0", id: 1, result: {} }));
		const { alerts, event } = keyPress();

		await remoteKey.onKeyDown(event);

		expect(calls).toHaveLength(1);
		expect(alerts).toEqual([]);
	});

	it("shows the alert and sends nothing on invalid settings", async () => {
		sdk.globalSettings = {};
		const { remoteKey, calls } = action(() => jsonResponse(200, {}));
		const { alerts, event } = keyPress();

		await remoteKey.onKeyDown(event);

		expect(calls).toHaveLength(0);
		expect(alerts).toEqual(["alert"]);
	});

	it("shows the alert and sends nothing when the token fails", async () => {
		const { remoteKey, calls } = action(
			() => jsonResponse(200, {}),
			async () => {
				throw new Error("token request failed");
			},
		);
		const { alerts, event } = keyPress();

		await remoteKey.onKeyDown(event);

		expect(calls).toHaveLength(0);
		expect(alerts).toEqual(["alert"]);
	});

	it("shows the alert when the tool call fails", async () => {
		const { remoteKey, calls, logs } = action(() => new Response(null, { status: 502 }));
		const { alerts, event } = keyPress();

		await remoteKey.onKeyDown(event);

		expect(calls).toHaveLength(1);
		expect(alerts).toEqual(["alert"]);
		expect(logs).toEqual(["com.pavel-karpovich.apple-tv.up: tool call failed: server answered with status 502"]);
	});
});
