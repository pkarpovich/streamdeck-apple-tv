import { readFile } from "node:fs/promises";

import streamDeck from "@elgato/streamdeck";

import { RemoteKeyAction } from "./actions.js";
import { remoteKeys } from "./keys.js";
import { TokenSource } from "./token.js";

const tokens = new TokenSource({ fetch, now: Date.now, readKey: (path) => readFile(path, "utf8") });
const log = (message: string): void => {
	streamDeck.logger.warn(message);
};

for (const key of remoteKeys) {
	streamDeck.actions.registerAction(new RemoteKeyAction(key, { tokens, fetch, log }));
}

await streamDeck.connect();
