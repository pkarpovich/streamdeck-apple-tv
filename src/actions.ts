import streamDeck, { SingletonAction } from "@elgato/streamdeck";

import { oneLine } from "./http.js";
import type { RemoteKey } from "./keys.js";
import { press, type PressDependencies } from "./press.js";

export interface KeyPress {
	readonly action: { showAlert(): Promise<void> };
}

export class RemoteKeyAction extends SingletonAction {
	override readonly manifestId: string;
	readonly #key: RemoteKey;
	readonly #deps: PressDependencies;

	constructor(key: RemoteKey, deps: PressDependencies) {
		super();
		this.manifestId = key.action;
		this.#key = key;
		this.#deps = deps;
	}

	override async onKeyDown(ev: KeyPress): Promise<void> {
		let ok: boolean;
		try {
			ok = await press(this.#deps, this.#key, await streamDeck.settings.getGlobalSettings());
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.#deps.log(`${this.#key.action}: key press failed: ${oneLine(reason)}`);
			ok = false;
		}
		if (!ok) {
			await ev.action.showAlert();
		}
	}
}
