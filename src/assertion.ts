import { sign, type KeyObject } from "node:crypto";

export const assertionLifetimeSeconds = 60;

export interface AssertionInput {
	readonly clientId: string;
	readonly audience: string;
	readonly keyId: string;
	readonly key: KeyObject;
	readonly issuedAt: number;
	readonly jwtId: string;
}

export function signAssertion(input: AssertionInput): string {
	const header = { alg: "RS256", typ: "JWT", kid: input.keyId };
	const claims = {
		iss: input.clientId,
		sub: input.clientId,
		aud: input.audience,
		jti: input.jwtId,
		iat: input.issuedAt,
		exp: input.issuedAt + assertionLifetimeSeconds,
	};
	const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;
	const signature = sign("sha256", Buffer.from(signingInput), input.key);
	return `${signingInput}.${signature.toString("base64url")}`;
}

function encodeSegment(value: object): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}
