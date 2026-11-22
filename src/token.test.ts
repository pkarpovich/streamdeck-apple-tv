import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { bodyOf, decodeJwt, fakeFetch, headersOf, jsonResponse, rsaKeyPair, settings, type Call } from "./testing.js";
import { TokenError, TokenSource } from "./token.js";

const keys = rsaKeyPair();
const startMs = 1_800_000_000_000;

function setup(handler: (call: Call) => Response | Promise<Response> = () => issued("token-1", 3600)) {
	const clock = { now: startMs };
	const network = fakeFetch(handler);
	const keyReads: string[] = [];
	const source = new TokenSource({
		fetch: network.fetch,
		now: () => clock.now,
		readKey: async (path) => {
			keyReads.push(path);
			return keys.pem;
		},
	});
	return { clock, calls: network.calls, keyReads, source };
}

function issued(accessToken: string, expiresIn: number): Response {
	return jsonResponse(200, { access_token: accessToken, token_type: "Bearer", expires_in: expiresIn });
}

function sequence(...tokens: string[]): () => Response {
	let index = 0;
	return () => issued(tokens[index++] ?? "exhausted", 3600);
}

function formOf(call: Call | undefined): Record<string, string> {
	return Object.fromEntries(new URLSearchParams(bodyOf(call)));
}

async function failureOf(promise: Promise<unknown>): Promise<TokenError> {
	const error = await promise.then(
		() => undefined,
		(reason: unknown) => reason,
	);
	if (!(error instanceof TokenError)) {
		throw new Error("expected a TokenError");
	}
	return error;
}

describe("TokenSource request", () => {
	it("posts the client_credentials form with a signed assertion", async () => {
		const { calls, keyReads, source } = setup();

		await expect(source.get(settings)).resolves.toBe("token-1");

		expect(keyReads).toEqual(["/keys/client.pem"]);
		expect(calls).toHaveLength(1);
		const [call] = calls;
		expect(call?.url).toBe("https://auth.example.com/oauth/token");
		expect(call?.init.method).toBe("POST");
		expect(call?.init.redirect).toBe("error");
		expect(call?.init.signal).toBeInstanceOf(AbortSignal);
		expect(headersOf(call)).toEqual({
			"content-type": "application/x-www-form-urlencoded",
			accept: "application/json",
		});
		const form = formOf(call);
		expect(Object.keys(form).sort()).toEqual([
			"client_assertion",
			"client_assertion_type",
			"client_id",
			"grant_type",
			"resource",
			"scope",
		]);
		expect(form).toMatchObject({
			grant_type: "client_credentials",
			client_id: "streamdeck-apple-tv",
			client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
			resource: "https://mcp.example.com/mcp",
			scope: "appletv:remote appletv:playback",
		});
		const assertion = decodeJwt(form.client_assertion ?? "", keys.publicKey);
		expect(assertion.verified).toBe(true);
		expect(assertion.header).toEqual({ alg: "RS256", typ: "JWT", kid: "key-1" });
		expect(assertion.claims).toEqual({
			iss: "streamdeck-apple-tv",
			sub: "streamdeck-apple-tv",
			aud: "https://auth.example.com",
			jti: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
			iat: startMs / 1000,
			exp: startMs / 1000 + 60,
		});
	});

	it("signs a fresh assertion for every token request", async () => {
		const { calls, clock, keyReads, source } = setup(sequence("token-1", "token-2"));

		await source.get(settings);
		source.drop();
		clock.now += 5_000;
		await source.get(settings);

		const [first, second] = calls.map((call) => decodeJwt(formOf(call).client_assertion ?? "", keys.publicKey));
		expect(first?.claims.jti).not.toBe(second?.claims.jti);
		expect(second?.claims.iat).toBe(startMs / 1000 + 5);
		expect(keyReads).toHaveLength(2);
	});
});

describe("TokenSource timeout", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("gives the token request 5 seconds", async () => {
		const timeout = vi.spyOn(AbortSignal, "timeout");
		const { calls, source } = setup();

		await source.get(settings);

		expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000);
		expect(calls[0]?.init.signal).toBe(timeout.mock.results[0]?.value);
	});
});

describe("TokenSource cache", () => {
	it("reuses the token", async () => {
		const { calls, source } = setup(sequence("token-1", "token-2"));

		await expect(source.get(settings)).resolves.toBe("token-1");
		await expect(source.get(settings)).resolves.toBe("token-1");

		expect(calls).toHaveLength(1);
	});

	it("renews the token 60 seconds before it expires", async () => {
		const { calls, clock, source } = setup(sequence("token-1", "token-2"));

		await source.get(settings);
		clock.now = startMs + 3_539_999;
		await expect(source.get(settings)).resolves.toBe("token-1");
		clock.now = startMs + 3_540_000;
		await expect(source.get(settings)).resolves.toBe("token-2");

		expect(calls).toHaveLength(2);
	});

	it("shares one request between concurrent callers", async () => {
		const answer = Promise.withResolvers<Response>();
		const requested = Promise.withResolvers<void>();
		const { calls, source } = setup(() => {
			requested.resolve();
			return answer.promise;
		});

		const pending = [source.get(settings), source.get(settings), source.get(settings)];
		await requested.promise;
		pending.push(source.get(settings));
		answer.resolve(issued("token-1", 3600));

		await expect(Promise.all(pending)).resolves.toEqual(["token-1", "token-1", "token-1", "token-1"]);
		expect(calls).toHaveLength(1);
	});

	it.each(["serverUrl", "issuer", "tokenEndpoint", "clientId", "keyId", "keyFile", "scope"] as const)(
		"drops the token when %s changes",
		async (name) => {
			const { calls, source } = setup(sequence("token-1", "token-2"));
			const changed = { ...settings, [name]: name === "keyFile" ? "/keys/other.pem" : `${settings[name]}/x` };

			await source.get(settings);
			await expect(source.get(changed)).resolves.toBe("token-2");

			expect(calls).toHaveLength(2);
		},
	);

	it("drops the token on request", async () => {
		const { calls, source } = setup(sequence("token-1", "token-2"));

		await source.get(settings);
		source.drop();
		await expect(source.get(settings)).resolves.toBe("token-2");

		expect(calls).toHaveLength(2);
	});

	it("keeps no failed request", async () => {
		let attempt = 0;
		const { calls, source } = setup(() =>
			attempt++ === 0 ? jsonResponse(503, { error: "temporarily_unavailable" }) : issued("token-2", 3600),
		);

		await expect(source.get(settings)).rejects.toThrow(TokenError);
		await expect(source.get(settings)).resolves.toBe("token-2");

		expect(calls).toHaveLength(2);
	});
});

describe("TokenSource failure", () => {
	it("keeps the status and the OAuth error code only", async () => {
		const { source } = setup(() =>
			jsonResponse(401, { error: "invalid_client", error_description: "client secret-detail is unknown" }),
		);

		const error = await failureOf(source.get(settings));

		expect(error.message).toBe("token request failed: status 401, error invalid_client");
		expect(error.status).toBe(401);
		expect(error.code).toBe("invalid_client");
		expect(JSON.stringify({ ...error, message: error.message })).not.toContain("secret-detail");
	});

	it("drops a body that is not an OAuth error", async () => {
		const { source } = setup(() => new Response("<html>secret-detail</html>", { status: 500 }));

		const error = await failureOf(source.get(settings));

		expect(error.message).toBe("token request failed: status 500");
		expect(error.code).toBeUndefined();
	});

	it("drops an error code outside the OAuth character set", async () => {
		const { source } = setup(() => jsonResponse(400, { error: 'bad"code\n' }));

		const error = await failureOf(source.get(settings));

		expect(error.message).toBe("token request failed: status 400");
		expect(error.code).toBeUndefined();
	});

	it.each([
		["no access_token", { expires_in: 3600 }],
		["an empty access_token", { access_token: "", expires_in: 3600 }],
		["no expires_in", { access_token: "token-1" }],
		["a zero expires_in", { access_token: "token-1", expires_in: 0 }],
		["a negative expires_in", { access_token: "token-1", expires_in: -5 }],
		["a string expires_in", { access_token: "token-1", expires_in: "3600" }],
	])("refuses a 200 answer with %s", async (_, body) => {
		const { source } = setup(() => jsonResponse(200, body));

		const error = await failureOf(source.get(settings));

		expect(error.message).toBe("token request failed: status 200, invalid token response");
		expect(error.message).not.toContain("token-1");
	});

	it("refuses a 200 answer that is not JSON", async () => {
		const { source } = setup(() => new Response("access_token=token-1", { status: 200 }));

		await expect(source.get(settings)).rejects.toThrow("token request failed: status 200, invalid token response");
	});

	it("reports a timeout", async () => {
		const { source } = setup(() => {
			throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
		});

		await expect(source.get(settings)).rejects.toThrow("token request failed: timed out");
	});

	it("reports a network error by its code only", async () => {
		const { source } = setup(() => {
			throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND", hostname: "auth.example.com" } });
		});

		const error = await failureOf(source.get(settings));

		expect(error.message).toBe("token request failed: request failed (ENOTFOUND)");
	});

	it("sends nothing when the key file cannot be read", async () => {
		const network = fakeFetch(() => issued("token-1", 3600));
		const source = new TokenSource({
			fetch: network.fetch,
			now: () => startMs,
			readKey: async (path) => {
				throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: "ENOENT" });
			},
		});

		const error = await failureOf(source.get(settings));

		expect(error.message).toBe("cannot read keyFile (ENOENT)");
		expect(network.calls).toHaveLength(0);
	});

	it.each([
		["text that is not a key", "not a key", "keyFile holds no PEM private key"],
		[
			"an EC key",
			generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
			"keyFile holds no RSA private key",
		],
	])("sends nothing when the key file holds %s", async (_, pem, message) => {
		const network = fakeFetch(() => issued("token-1", 3600));
		const source = new TokenSource({ fetch: network.fetch, now: () => startMs, readKey: async () => pem });

		const error = await failureOf(source.get(settings));

		expect(error.message).toBe(message);
		expect(error.message).not.toContain("PRIVATE KEY");
		expect(network.calls).toHaveLength(0);
	});
});
