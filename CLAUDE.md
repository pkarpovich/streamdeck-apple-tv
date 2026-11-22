# Apple TV for Stream Deck

## Commands

Every command runs through mise. Node.js and pnpm are pinned in `mise.toml`.

- `mise run check` - the gate: Prettier check, `tsc`, vitest, `streamdeck validate`. Nothing is done until it is green.
- `mise run build` - `tsc -p tsconfig.build.json` into `build/`, then rollup into `com.pavel-karpovich.apple-tv.sdPlugin/bin/plugin.js`.
- `mise run pack [version]` - `dist/com.pavel-karpovich.apple-tv.streamDeckPlugin`. A version such as `1.2.3` is written into `manifest.json` as `1.2.3.0`. The release workflow passes the tag without its `v`. The tag is the only source of the version.

`streamdeck pack` rewrites `manifest.json` in its own format, so the manifest keeps that format and Prettier skips it. Prettier also skips the vendored `sdpi-components` files.

The build compiles with `tsc` before rollup because TypeScript 7 has no JavaScript API, so `@rollup/plugin-typescript` from the Elgato template cannot load it. Node's `stripTypeScriptTypes` was rejected because it is still experimental.

## Layout

- `src/settings.ts` - validates the seven global settings.
- `src/assertion.ts` - signs the RS256 client assertion with `node:crypto`.
- `src/token.ts` - `TokenSource`: the token request, the in-memory token and its renewal.
- `src/tool-call.ts` - one `tools/call` request and the rules for reading its answer.
- `src/http.ts` - body size limit, one-line reasons, transport error reasons.
- `src/keys.ts` - the eight keys and their tool calls.
- `src/press.ts` - one key press: settings, token, tool call, log line.
- `src/actions.ts` - the Stream Deck action class. `src/plugin.ts` - the entry point.
- `com.pavel-karpovich.apple-tv.sdPlugin/` - manifest, images and the Property Inspector. `ui/settings.html` uses Elgato's `sdpi-components` (local copy of v4.0.1 with its licence in `ui/`): each field is an `sdpi-textfield` with `setting` and `global`, with no own script or style. The library runs in the Property Inspector only and is not a runtime dependency of the plugin.

Only `actions.ts` and `plugin.ts` import `@elgato/streamdeck`: importing it opens a log file in the working directory. Everything else gets `fetch` and the clock as parameters, so tests use no network and no timers.

## Invariants

- One runtime dependency: `@elgato/streamdeck`. Global `fetch`, `node:crypto`, no MCP SDK.
- The tool call request shape and headers are fixed by the production server. Do not change them and do not add an `initialize` exchange.
- Invalid settings send no request. A failed token request sends no tool call. One press is at most one tool call, with no retry.
- `serverUrl`, `issuer` and `tokenEndpoint` must be `https`. Requests do not follow redirects.
- The private key is read from `keyFile` for each token request and never stored, logged or put into an error.
- No log line carries the access token, the assertion, the `Authorization` header or key material. A token failure keeps only the HTTP status and the OAuth `error` code.
- The token is reused until 60 s before it expires. Concurrent presses share one request. A settings change or a `401` from the MCP server drops it.
- Any failure of a press, a thrown error included, shows the alert on the key and writes one log line. A success shows nothing.
- The token request has a 5 s timeout and the tool call 10 s. A tool answer with a non-null `error` or without an object `result` is a failure.
- No comments in code. No `@ts-ignore`, no `any`, no skipped tests.
