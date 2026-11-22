import type { ToolCall } from "./tool-call.js";

export const pluginId = "com.pavel-karpovich.apple-tv";

export interface RemoteKey {
	readonly action: string;
	readonly call: ToolCall;
}

function button(name: string): RemoteKey {
	return { action: `${pluginId}.${name}`, call: { name: "remote", arguments: { button: name } } };
}

export const remoteKeys: readonly RemoteKey[] = [
	button("up"),
	button("down"),
	button("left"),
	button("right"),
	button("select"),
	button("menu"),
	button("home"),
	{ action: `${pluginId}.play-pause`, call: { name: "play_pause", arguments: {} } },
];
