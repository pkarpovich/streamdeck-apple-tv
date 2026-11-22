import { createPrivateKey } from "node:crypto";

import { describe, expect, it } from "vitest";

import { signAssertion } from "./assertion.js";
import { decodeJwt, rsaKeyPair } from "./testing.js";

describe("signAssertion", () => {
	const keys = rsaKeyPair();

	it("signs an RS256 JWT with the client claims", () => {
		const jwt = signAssertion({
			clientId: "client-1",
			audience: "https://auth.example.com",
			keyId: "key-1",
			key: createPrivateKey(keys.pem),
			issuedAt: 1_800_000_000,
			jwtId: "6f1c1f9e-6c43-4b3e-9b0e-2f1d3c4b5a69",
		});

		const decoded = decodeJwt(jwt, keys.publicKey);

		expect(decoded.verified).toBe(true);
		expect(decoded.header).toEqual({ alg: "RS256", typ: "JWT", kid: "key-1" });
		expect(decoded.claims).toEqual({
			iss: "client-1",
			sub: "client-1",
			aud: "https://auth.example.com",
			jti: "6f1c1f9e-6c43-4b3e-9b0e-2f1d3c4b5a69",
			iat: 1_800_000_000,
			exp: 1_800_000_060,
		});
	});

	it("fails verification with another key", () => {
		const jwt = signAssertion({
			clientId: "client-1",
			audience: "https://auth.example.com",
			keyId: "key-1",
			key: createPrivateKey(keys.pem),
			issuedAt: 1_800_000_000,
			jwtId: "6f1c1f9e-6c43-4b3e-9b0e-2f1d3c4b5a69",
		});

		expect(decodeJwt(jwt, rsaKeyPair().publicKey).verified).toBe(false);
	});
});
