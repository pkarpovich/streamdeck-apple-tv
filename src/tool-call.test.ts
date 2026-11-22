import { afterEach, describe, expect, it, vi } from "vitest";

import { remoteKeys } from "./keys.js";
import { bodyOf, fakeFetch, headersOf, jsonResponse, type Call } from "./testing.js";
import { callTool, type ToolCall, type ToolResult } from "./tool-call.js";

const serverUrl = "https://mcp.example.com/mcp";
const remoteUp: ToolCall = { name: "remote", arguments: { button: "up" } };

async function answer(response: Response | (() => Response)): Promise<{ result: ToolResult; calls: Call[] }> {
	const network = fakeFetch(typeof response === "function" ? response : () => response);
	const result = await callTool(network.fetch, serverUrl, "access-1", remoteUp);
	return { result, calls: network.calls };
}

function eventStream(body: string): Response {
	return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function chunked(chunks: Uint8Array[]): Response {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
	return new Response(stream, { status: 200, headers: { "Content-Type": "application/json" } });
}

function paddedResult(size: number): string {
	const prefix = '{"jsonrpc":"2.0","id":1,"result":{"pad":"';
	const suffix = '"}}';
	return `${prefix}${"x".repeat(size - prefix.length - suffix.length)}${suffix}`;
}

const success = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } };

describe("callTool request", () => {
	const expectedBodies: Record<string, string> = {
		"com.pavel-karpovich.apple-tv.up": "remote",
		"com.pavel-karpovich.apple-tv.down": "remote",
		"com.pavel-karpovich.apple-tv.left": "remote",
		"com.pavel-karpovich.apple-tv.right": "remote",
		"com.pavel-karpovich.apple-tv.select": "remote",
		"com.pavel-karpovich.apple-tv.menu": "remote",
		"com.pavel-karpovich.apple-tv.home": "remote",
		"com.pavel-karpovich.apple-tv.play-pause": "play_pause",
	};

	it("covers the eight keys", () => {
		expect(remoteKeys.map((key) => key.action)).toEqual(Object.keys(expectedBodies));
	});

	it.each(remoteKeys.map((key) => [key.action, key] as const))("sends the request for %s", async (_, key) => {
		const network = fakeFetch(() => jsonResponse(200, success));

		await expect(callTool(network.fetch, serverUrl, "access-1", key.call)).resolves.toEqual({ ok: true });

		const button = key.action.slice("com.pavel-karpovich.apple-tv.".length);
		const tool = expectedBodies[key.action];
		const toolArguments = tool === "remote" ? `{"button":"${button}"}` : "{}";
		expect(network.calls).toHaveLength(1);
		const [call] = network.calls;
		expect(call?.url).toBe(serverUrl);
		expect(call?.init.method).toBe("POST");
		expect(call?.init.redirect).toBe("error");
		expect(call?.init.signal).toBeInstanceOf(AbortSignal);
		expect(headersOf(call)).toEqual({
			authorization: "Bearer access-1",
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2026-07-28",
			"mcp-method": "tools/call",
			"mcp-name": tool,
		});
		expect(bodyOf(call)).toBe(
			`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"${tool}","arguments":${toolArguments},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}`,
		);
	});
});

describe("callTool timeout", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("gives the request 10 seconds", async () => {
		const timeout = vi.spyOn(AbortSignal, "timeout");
		const network = fakeFetch(() => jsonResponse(200, success));

		await callTool(network.fetch, serverUrl, "access-1", remoteUp);

		expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000);
		expect(network.calls[0]?.init.signal).toBe(timeout.mock.results[0]?.value);
	});
});

describe("callTool status", () => {
	it("marks a 401 as a refused token", async () => {
		const { result } = await answer(new Response("nope", { status: 401 }));
		expect(result).toEqual({ ok: false, unauthorized: true, reason: "server refused the token (401)" });
	});

	it("reports a 403 as a missing scope", async () => {
		const { result } = await answer(new Response("nope", { status: 403 }));
		expect(result).toEqual({ ok: false, unauthorized: false, reason: "token lacks a scope (403)" });
	});

	it.each([201, 204, 400, 404, 500, 503])("names any other status %i", async (status) => {
		const { result } = await answer(new Response(status === 204 ? null : "body", { status }));
		expect(result).toEqual({ ok: false, unauthorized: false, reason: `server answered with status ${status}` });
	});

	it("reports a timeout", async () => {
		const { result } = await answer(() => {
			throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
		});
		expect(result).toEqual({ ok: false, unauthorized: false, reason: "timed out" });
	});
});

describe("callTool answer", () => {
	it("accepts a JSON result", async () => {
		expect((await answer(jsonResponse(200, success))).result).toEqual({ ok: true });
	});

	it("accepts a result without content", async () => {
		expect((await answer(jsonResponse(200, { jsonrpc: "2.0", id: 1, result: {} }))).result).toEqual({ ok: true });
	});

	it("accepts a result whose structuredContent reports success", async () => {
		const body = { jsonrpc: "2.0", id: 1, result: { structuredContent: { success: true, message: "done" } } };
		expect((await answer(jsonResponse(200, body))).result).toEqual({ ok: true });
	});

	it("takes the first data line of an event stream", async () => {
		const stream = [
			"event: message",
			`data: ${JSON.stringify(success)}`,
			"",
			`data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "second event" } })}`,
			"",
		].join("\n");
		expect((await answer(eventStream(stream))).result).toEqual({ ok: true });
	});

	it("reads the first data line of an event stream as the answer", async () => {
		const stream = `id: 1\r\ndata:${JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "busy" } })}\r\n\r\n`;
		expect((await answer(eventStream(stream))).result).toEqual({ ok: false, unauthorized: false, reason: "busy" });
	});

	it("refuses an event stream without a data line", async () => {
		const { result } = await answer(eventStream(": keep-alive\n\n"));
		expect(result).toEqual({ ok: false, unauthorized: false, reason: "event stream has no data line" });
	});

	it("reports a JSON-RPC error with its message", async () => {
		const body = { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown tool: remote" } };
		expect((await answer(jsonResponse(200, body))).result).toEqual({
			ok: false,
			unauthorized: false,
			reason: "Unknown tool: remote",
		});
	});

	it("reports a JSON-RPC error without a message", async () => {
		const body = { jsonrpc: "2.0", id: 1, error: { code: -32603 } };
		expect((await answer(jsonResponse(200, body))).result).toEqual({
			ok: false,
			unauthorized: false,
			reason: "JSON-RPC error without a message",
		});
	});

	it("reports isError with the text of the first content item", async () => {
		const body = {
			jsonrpc: "2.0",
			id: 1,
			result: {
				isError: true,
				content: [
					{ type: "text", text: "Apple TV is not reachable" },
					{ type: "text", text: "second item" },
				],
			},
		};
		expect((await answer(jsonResponse(200, body))).result).toEqual({
			ok: false,
			unauthorized: false,
			reason: "Apple TV is not reachable",
		});
	});

	it("reports isError without text", async () => {
		const body = { jsonrpc: "2.0", id: 1, result: { isError: true, content: [] } };
		expect((await answer(jsonResponse(200, body))).result).toEqual({
			ok: false,
			unauthorized: false,
			reason: "tool error without text",
		});
	});

	it("reports structuredContent.success false with its message", async () => {
		const body = {
			jsonrpc: "2.0",
			id: 1,
			result: {
				content: [{ type: "text", text: "{}" }],
				structuredContent: { success: false, message: "No device paired" },
			},
		};
		expect((await answer(jsonResponse(200, body))).result).toEqual({
			ok: false,
			unauthorized: false,
			reason: "No device paired",
		});
	});

	it("reports structuredContent.success false without a message", async () => {
		const body = { jsonrpc: "2.0", id: 1, result: { structuredContent: { success: false } } };
		expect((await answer(jsonResponse(200, body))).result).toEqual({
			ok: false,
			unauthorized: false,
			reason: "tool failed without a message",
		});
	});

	it("refuses an answer without a result", async () => {
		expect((await answer(jsonResponse(200, { jsonrpc: "2.0", id: 1 }))).result).toEqual({
			ok: false,
			unauthorized: false,
			reason: "answer has no result",
		});
	});

	it("reads past an error that is null", async () => {
		const body = { jsonrpc: "2.0", id: 1, error: null, result: { content: [] } };
		expect((await answer(jsonResponse(200, body))).result).toEqual({ ok: true });
	});

	it.each([
		["null", null],
		["a string", "ok"],
		["a number", 1],
		["an array", [{ type: "text", text: "ok" }]],
	])("refuses a result that is %s", async (_, result) => {
		expect((await answer(jsonResponse(200, { jsonrpc: "2.0", id: 1, error: null, result }))).result).toEqual({
			ok: false,
			unauthorized: false,
			reason: "answer has no result",
		});
	});

	it("refuses an answer that is not JSON", async () => {
		expect((await answer(new Response("<html></html>", { status: 200 }))).result).toEqual({
			ok: false,
			unauthorized: false,
			reason: "answer is not JSON",
		});
	});

	it("refuses an answer that is not a JSON object", async () => {
		expect((await answer(jsonResponse(200, [success]))).result).toEqual({
			ok: false,
			unauthorized: false,
			reason: "answer is not a JSON-RPC message",
		});
	});

	it("makes a reason one line of at most 200 characters", async () => {
		const message = `first line\nsecond line\t${"y".repeat(400)}`;
		const body = { jsonrpc: "2.0", id: 1, error: { code: -1, message } };

		const { result } = await answer(jsonResponse(200, body));

		expect(result.ok).toBe(false);
		const reason = result.ok ? "" : result.reason;
		expect(reason).toHaveLength(200);
		expect(reason).toMatch(/^first line second line y+$/u);
	});
});

describe("callTool size limit", () => {
	const mebibyte = 1024 * 1024;

	it("accepts an answer of exactly 1 MiB", async () => {
		const body = new TextEncoder().encode(paddedResult(mebibyte));
		const half = mebibyte / 2;
		const { result } = await answer(() => chunked([body.subarray(0, half), body.subarray(half)]));
		expect(result).toEqual({ ok: true });
	});

	it("refuses an answer over 1 MiB", async () => {
		const body = new TextEncoder().encode(paddedResult(mebibyte + 1));
		const { result } = await answer(() => chunked([body.subarray(0, 1000), body.subarray(1000)]));
		expect(result).toEqual({ ok: false, unauthorized: false, reason: "answer exceeds 1 MiB" });
	});

	it("refuses an event stream over 1 MiB", async () => {
		const { result } = await answer(eventStream(`data: ${paddedResult(mebibyte)}\n\n`));
		expect(result).toEqual({ ok: false, unauthorized: false, reason: "answer exceeds 1 MiB" });
	});
});
