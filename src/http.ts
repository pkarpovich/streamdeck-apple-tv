export const maxBodyBytes = 1024 * 1024;

const maxReasonLength = 200;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function oneLine(text: string): string {
	const flat = text
		.replace(/\s+/gu, " ")
		.replace(/\p{Cc}/gu, "")
		.trim();
	return Array.from(flat).slice(0, maxReasonLength).join("");
}

export async function readLimited(response: Response, limit: number): Promise<string | undefined> {
	if (response.body === null) {
		return "";
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		size += value.byteLength;
		if (size > limit) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}

export async function discard(response: Response): Promise<void> {
	await response.body?.cancel().catch(() => undefined);
}

export function transportReason(error: unknown): string {
	if (isRecord(error) && error.name === "TimeoutError") {
		return "timed out";
	}
	const code = causeCode(error);
	if (code !== undefined) {
		return `request failed (${code})`;
	}
	return "request failed";
}

function causeCode(error: unknown): string | undefined {
	if (!isRecord(error) || !isRecord(error.cause)) {
		return undefined;
	}
	const { code } = error.cause;
	if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/u.test(code)) {
		return code;
	}
	return undefined;
}
