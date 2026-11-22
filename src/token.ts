import { createPrivateKey, randomUUID, type KeyObject } from "node:crypto";

import { signAssertion } from "./assertion.js";
import { isRecord, maxBodyBytes, readLimited, transportReason } from "./http.js";
import { settingsIdentity, type Settings } from "./settings.js";

const requestTimeoutMs = 5_000;
const renewalMarginMs = 60_000;
const oauthErrorCode = /^[\x20\x21\x23-\x5B\x5D-\x7E]{1,64}$/u;

export class TokenError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly code?: string,
	) {
		super(message);
		this.name = "TokenError";
	}
}

export interface TokenSourceOptions {
	readonly fetch: typeof fetch;
	readonly now: () => number;
	readonly readKey: (path: string) => Promise<string>;
}

interface Entry {
	readonly identity: string;
	readonly accessToken: Promise<string>;
	expiresAt?: number;
}

interface IssuedToken {
	readonly accessToken: string;
	readonly expiresAt: number;
}

export class TokenSource {
	readonly #fetch: typeof fetch;
	readonly #now: () => number;
	readonly #readKey: (path: string) => Promise<string>;
	#entry: Entry | undefined;

	constructor(options: TokenSourceOptions) {
		this.#fetch = options.fetch;
		this.#now = options.now;
		this.#readKey = options.readKey;
	}

	get(settings: Settings): Promise<string> {
		const identity = settingsIdentity(settings);
		const entry = this.#entry;
		if (entry !== undefined && entry.identity === identity && !this.#due(entry)) {
			return entry.accessToken;
		}
		return this.#start(settings, identity).accessToken;
	}

	drop(): void {
		this.#entry = undefined;
	}

	#due(entry: Entry): boolean {
		return entry.expiresAt !== undefined && this.#now() >= entry.expiresAt - renewalMarginMs;
	}

	#start(settings: Settings, identity: string): Entry {
		const entry: Entry = {
			identity,
			accessToken: this.#request(settings).then(
				(token) => {
					entry.expiresAt = token.expiresAt;
					return token.accessToken;
				},
				(error: unknown) => {
					if (this.#entry === entry) {
						this.#entry = undefined;
					}
					throw error;
				},
			),
		};
		this.#entry = entry;
		return entry;
	}

	async #request(settings: Settings): Promise<IssuedToken> {
		const key = await this.#loadKey(settings.keyFile);
		const startedAt = this.#now();
		const assertion = signAssertion({
			clientId: settings.clientId,
			audience: settings.issuer,
			keyId: settings.keyId,
			key,
			issuedAt: Math.floor(startedAt / 1000),
			jwtId: randomUUID(),
		});
		const form = new URLSearchParams({
			grant_type: "client_credentials",
			client_id: settings.clientId,
			client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
			client_assertion: assertion,
			resource: settings.serverUrl,
			scope: settings.scope,
		});
		let text: string | undefined;
		let status: number;
		try {
			const response = await this.#fetch(settings.tokenEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
				body: form.toString(),
				redirect: "error",
				signal: AbortSignal.timeout(requestTimeoutMs),
			});
			status = response.status;
			text = await readLimited(response, maxBodyBytes);
		} catch (error) {
			throw new TokenError(`token request failed: ${transportReason(error)}`);
		}
		const body = parseJson(text);
		if (status !== 200) {
			const code = oauthError(body);
			const suffix = code === undefined ? "" : `, error ${code}`;
			throw new TokenError(`token request failed: status ${status}${suffix}`, status, code);
		}
		if (
			!isRecord(body) ||
			typeof body.access_token !== "string" ||
			body.access_token === "" ||
			typeof body.expires_in !== "number" ||
			!Number.isFinite(body.expires_in) ||
			body.expires_in <= 0
		) {
			throw new TokenError("token request failed: status 200, invalid token response", status);
		}
		return { accessToken: body.access_token, expiresAt: startedAt + body.expires_in * 1000 };
	}

	async #loadKey(path: string): Promise<KeyObject> {
		let pem: string;
		try {
			pem = await this.#readKey(path);
		} catch (error) {
			const code =
				isRecord(error) && typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/u.test(error.code)
					? ` (${error.code})`
					: "";
			throw new TokenError(`cannot read keyFile${code}`);
		}
		let key: KeyObject;
		try {
			key = createPrivateKey(pem);
		} catch {
			throw new TokenError("keyFile holds no PEM private key");
		}
		if (key.asymmetricKeyType !== "rsa") {
			throw new TokenError("keyFile holds no RSA private key");
		}
		return key;
	}
}

function parseJson(text: string | undefined): unknown {
	if (text === undefined) {
		return undefined;
	}
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function oauthError(body: unknown): string | undefined {
	if (isRecord(body) && typeof body.error === "string" && oauthErrorCode.test(body.error)) {
		return body.error;
	}
	return undefined;
}
