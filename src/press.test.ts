import { describe, expect, it } from "vitest";

import { remoteKeys, type RemoteKey } from "./keys.js";
import { press } from "./press.js";
import { fakeFetch, headersOf, jsonResponse, rsaKeyPair, settings, type Call } from "./testing.js";
import { TokenSource } from "./token.js";

const keys = rsaKeyPair();
const [up = fail()] = remoteKeys;
const success = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } };

function fail(): RemoteKey {
	throw new Error("no keys");
}

function issued(_: Call, count: number): Response {
	return jsonResponse(200, { access_token: `access-${count}`, token_type: "Bearer", expires_in: 3600 });
}

function setup(
	tool: (call: Call) => Response = () => jsonResponse(200, success),
	token: (call: Call, count: number) => Response = issued,
) {
	const logs: string[] = [];
	let tokenCount = 0;
	const network = fakeFetch((call) => (call.url === settings.tokenEndpoint ? token(call, ++tokenCount) : tool(call)));
	const tokens = new TokenSource({ fetch: network.fetch, now: () => 1_800_000_000_000, readKey: async () => keys.pem });
	const deps = { tokens, fetch: network.fetch, log: (message: string) => logs.push(message) };
	const tokenCalls = () => network.calls.filter((call) => call.url === settings.tokenEndpoint);
	const toolCalls = () => network.calls.filter((call) => call.url === settings.serverUrl);
	return { deps, logs, calls: network.calls, tokenCalls, toolCalls };
}

describe("press", () => {
	it("calls the tool and logs nothing on success", async () => {
		const { deps, logs, tokenCalls, toolCalls } = setup();

		await expect(press(deps, up, settings)).resolves.toBe(true);

		expect(tokenCalls()).toHaveLength(1);
		expect(toolCalls()).toHaveLength(1);
		expect(headersOf(toolCalls()[0]).authorization).toBe("Bearer access-1");
		expect(logs).toEqual([]);
	});

	it("sends no request when a setting is missing", async () => {
		const { deps, logs, calls } = setup();
		const { clientId: _, ...incomplete } = settings;

		await expect(press(deps, up, incomplete)).resolves.toBe(false);

		expect(calls).toHaveLength(0);
		expect(logs).toEqual(["com.pavel-karpovich.apple-tv.up: invalid settings: clientId is missing"]);
	});

	it("sends no request when a URL is not https", async () => {
		const { deps, logs, calls } = setup();

		await expect(press(deps, up, { ...settings, serverUrl: "http://mcp.example.com/mcp" })).resolves.toBe(false);

		expect(calls).toHaveLength(0);
		expect(logs).toEqual(["com.pavel-karpovich.apple-tv.up: invalid settings: serverUrl must be an https URL"]);
	});

	it("sends no tool call when the token request fails", async () => {
		const { deps, logs, tokenCalls, toolCalls } = setup(undefined, () =>
			jsonResponse(400, { error: "invalid_scope", error_description: "scope secret-detail is unknown" }),
		);

		await expect(press(deps, up, settings)).resolves.toBe(false);

		expect(tokenCalls()).toHaveLength(1);
		expect(toolCalls()).toHaveLength(0);
		expect(logs).toEqual(["com.pavel-karpovich.apple-tv.up: token request failed: status 400, error invalid_scope"]);
	});

	it("logs the reason when the tool call fails", async () => {
		const { deps, logs } = setup(() =>
			jsonResponse(200, {
				jsonrpc: "2.0",
				id: 1,
				result: { structuredContent: { success: false, message: "No device paired" } },
			}),
		);

		await expect(press(deps, up, settings)).resolves.toBe(false);

		expect(logs).toEqual(["com.pavel-karpovich.apple-tv.up: tool call failed: No device paired"]);
	});

	it("drops the token after a 401 without a retry", async () => {
		let toolCount = 0;
		const { deps, logs, tokenCalls, toolCalls } = setup(() =>
			++toolCount === 1 ? new Response(null, { status: 401 }) : jsonResponse(200, success),
		);

		await expect(press(deps, up, settings)).resolves.toBe(false);
		expect(tokenCalls()).toHaveLength(1);
		expect(toolCalls()).toHaveLength(1);
		expect(logs).toEqual(["com.pavel-karpovich.apple-tv.up: tool call failed: server refused the token (401)"]);

		await expect(press(deps, up, settings)).resolves.toBe(true);
		expect(tokenCalls()).toHaveLength(2);
		expect(headersOf(toolCalls()[1]).authorization).toBe("Bearer access-2");
	});

	it("keeps the token after a 403", async () => {
		const { deps, tokenCalls } = setup(() => new Response(null, { status: 403 }));

		await press(deps, up, settings);
		await press(deps, up, settings);

		expect(tokenCalls()).toHaveLength(1);
	});

	it("logs no token, assertion, header or key material", async () => {
		const scenarios = [
			setup(() => new Response(null, { status: 401 })),
			setup(() => new Response(null, { status: 500 })),
			setup(() => jsonResponse(200, { jsonrpc: "2.0", id: 1, error: { code: -1, message: "failed" } })),
			setup(undefined, () => jsonResponse(401, { error: "invalid_client" })),
			setup(undefined, () => jsonResponse(200, { access_token: "access-1", expires_in: 0 })),
		];

		for (const scenario of scenarios) {
			await press(scenario.deps, up, settings);
			expect(scenario.logs).toHaveLength(1);
			for (const line of scenario.logs) {
				expect(line).not.toMatch(/access-\d|Bearer|eyJ|PRIVATE KEY/u);
			}
		}
	});
});
