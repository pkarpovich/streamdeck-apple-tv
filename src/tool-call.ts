import { discard, isRecord, maxBodyBytes, oneLine, readLimited, transportReason } from "./http.js";

export const protocolVersion = "2026-07-28";

const requestTimeoutMs = 10_000;

export interface ToolCall {
	readonly name: string;
	readonly arguments: Readonly<Record<string, string>>;
}

export type ToolResult =
	{ readonly ok: true } | { readonly ok: false; readonly unauthorized: boolean; readonly reason: string };

export async function callTool(
	fetchFn: typeof fetch,
	serverUrl: string,
	accessToken: string,
	call: ToolCall,
): Promise<ToolResult> {
	let response: Response;
	try {
		response = await fetchFn(serverUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				"MCP-Protocol-Version": protocolVersion,
				"Mcp-Method": "tools/call",
				"Mcp-Name": call.name,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: call.name,
					arguments: call.arguments,
					_meta: {
						"io.modelcontextprotocol/protocolVersion": protocolVersion,
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
			redirect: "error",
			signal: AbortSignal.timeout(requestTimeoutMs),
		});
	} catch (error) {
		return failure(transportReason(error));
	}
	if (response.status === 401) {
		await discard(response);
		return { ok: false, unauthorized: true, reason: "server refused the token (401)" };
	}
	if (response.status === 403) {
		await discard(response);
		return failure("token lacks a scope (403)");
	}
	if (response.status !== 200) {
		await discard(response);
		return failure(`server answered with status ${response.status}`);
	}
	let body: string | undefined;
	try {
		body = await readLimited(response, maxBodyBytes);
	} catch (error) {
		return failure(transportReason(error));
	}
	if (body === undefined) {
		return failure("answer exceeds 1 MiB");
	}
	const contentType = response.headers.get("content-type") ?? "";
	const payload = contentType.toLowerCase().startsWith("text/event-stream") ? firstData(body) : body;
	if (payload === undefined) {
		return failure("event stream has no data line");
	}
	return interpret(payload);
}

function interpret(payload: string): ToolResult {
	let message: unknown;
	try {
		message = JSON.parse(payload);
	} catch {
		return failure("answer is not JSON");
	}
	if (!isRecord(message)) {
		return failure("answer is not a JSON-RPC message");
	}
	if (message.error !== undefined && message.error !== null) {
		const text = isRecord(message.error) ? message.error.message : undefined;
		return failure(typeof text === "string" ? text : "JSON-RPC error without a message");
	}
	const { result } = message;
	if (!isRecord(result)) {
		return failure("answer has no result");
	}
	if (result.isError === true) {
		return failure(firstText(result.content) ?? "tool error without text");
	}
	const structured = result.structuredContent;
	if (isRecord(structured) && structured.success === false) {
		return failure(typeof structured.message === "string" ? structured.message : "tool failed without a message");
	}
	return { ok: true };
}

function firstData(body: string): string | undefined {
	for (const line of body.split(/\r\n|\r|\n/u)) {
		if (line.startsWith("data:")) {
			return line.slice("data:".length).replace(/^ /u, "");
		}
	}
	return undefined;
}

function firstText(content: unknown): string | undefined {
	if (!Array.isArray(content)) {
		return undefined;
	}
	const first: unknown = content[0];
	return isRecord(first) && typeof first.text === "string" ? first.text : undefined;
}

function failure(reason: string): ToolResult {
	return { ok: false, unauthorized: false, reason: oneLine(reason) };
}
