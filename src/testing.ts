import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";

import type { Settings } from "./settings.js";

export const settings: Settings = {
	serverUrl: "https://mcp.example.com/mcp",
	issuer: "https://auth.example.com",
	tokenEndpoint: "https://auth.example.com/oauth/token",
	clientId: "streamdeck-apple-tv",
	keyId: "key-1",
	keyFile: "/keys/client.pem",
	scope: "appletv:remote appletv:playback",
};

export interface KeyPair {
	readonly pem: string;
	readonly publicKey: KeyObject;
}

export function rsaKeyPair(): KeyPair {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	return { pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKey };
}

export interface DecodedJwt {
	readonly header: unknown;
	readonly claims: Record<string, unknown>;
	readonly verified: boolean;
}

export function decodeJwt(jwt: string, publicKey: KeyObject): DecodedJwt {
	const [header = "", claims = "", signature = ""] = jwt.split(".");
	return {
		header: JSON.parse(Buffer.from(header, "base64url").toString()),
		claims: JSON.parse(Buffer.from(claims, "base64url").toString()),
		verified: verify("sha256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url")),
	};
}

export interface Call {
	readonly url: string;
	readonly init: RequestInit;
}

export interface FakeFetch {
	readonly fetch: typeof fetch;
	readonly calls: Call[];
}

export function fakeFetch(handler: (call: Call) => Response | Promise<Response>): FakeFetch {
	const calls: Call[] = [];
	const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const call = { url: String(input), init: init ?? {} };
		calls.push(call);
		return handler(call);
	};
	return { fetch: fetchFn, calls };
}

export function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function headersOf(call: Call | undefined): Record<string, string> {
	return Object.fromEntries(new Headers(call?.init.headers).entries());
}

export function bodyOf(call: Call | undefined): string {
	const body = call?.init.body;
	if (typeof body !== "string") {
		throw new Error("request body is not a string");
	}
	return body;
}
