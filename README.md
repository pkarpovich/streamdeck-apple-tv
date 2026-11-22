# Apple TV for Stream Deck

A Stream Deck plugin with eight keys that act as the buttons of an Apple TV remote: up, down, left, right, select, menu, home and play/pause. One key press is one tool call to an MCP server that controls the Apple TV. The plugin gets an OAuth 2.0 access token for that server by itself, as its own client.

A failed press shows the alert triangle on the key and writes the reason to the plugin log. A successful press shows nothing.

The plugin log is `logs/com.pavel-karpovich.apple-tv.0.log` inside the installed plugin folder `com.pavel-karpovich.apple-tv.sdPlugin`, which on macOS is under `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`. Stream Deck keeps the ten most recent log files.

## Installation

Download `com.pavel-karpovich.apple-tv.streamDeckPlugin` from the latest GitHub release and open it. Stream Deck installs the plugin, and a newer release file installs over the old one. The plugin needs Stream Deck 7.1 or later on macOS 12 or later.

Drag the keys from the "Apple TV" category onto the Stream Deck. Select any of them and fill in the settings below. All eight keys share one set of settings. The settings form uses Elgato's [sdpi-components](https://sdpi-components.dev) v4.0.1, kept as a local copy in `com.pavel-karpovich.apple-tv.sdPlugin/ui/` with its MIT licence.

## Settings

Every setting is required and has no default.

| Setting                          | Meaning                                                                                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP server URL (`serverUrl`)     | URL of the MCP endpoint, for example `https://example.com/mcp`. It is also the resource the token is requested for. Must be `https`.                                                                                                      |
| Issuer (`issuer`)                | Issuer identifier of the authorization server. It is the audience of the client assertion. Must be `https`.                                                                                                                               |
| Token endpoint (`tokenEndpoint`) | Token endpoint of the authorization server. Must be `https`.                                                                                                                                                                              |
| Client ID (`clientId`)           | OAuth client id of this plugin.                                                                                                                                                                                                           |
| Key ID (`keyId`)                 | The `kid` the authorization server knows the client's key by.                                                                                                                                                                             |
| Private key file (`keyFile`)     | Absolute path of the client's private key, an RSA private key in PEM, PKCS#8 (`BEGIN PRIVATE KEY`) or PKCS#1 (`BEGIN RSA PRIVATE KEY`), not encrypted. The plugin reads the file when it requests a token and keeps the key nowhere else. |
| Scope (`scope`)                  | Space-separated scopes to request.                                                                                                                                                                                                        |

## Authorization server

The authorization server must have a client for this plugin with:

- the `client_credentials` grant;
- `private_key_jwt` client authentication with an RS256 public key registered under the `keyId`;
- the scopes the MCP server requires for its tools;
- support for the `resource` parameter (RFC 8707), so the token is issued for `serverUrl`.

Create the key pair with `openssl`:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out client-key.pem
openssl pkey -in client-key.pem -pubout -out client-key.pub.pem
chmod 600 client-key.pem
```

Register `client-key.pub.pem` with the client and set `keyFile` to the absolute path of `client-key.pem`.

For each token the plugin posts `grant_type=client_credentials`, `client_id`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, `client_assertion`, `resource` and `scope`. The assertion is a JWT signed with RS256, with the header `kid`, `iss` and `sub` set to the client id, `aud` set to the issuer, a fresh `jti`, and an `exp` 60 seconds after `iat`. The plugin keeps the token in memory and requests a new one 60 seconds before it expires, after a settings change, and after the MCP server answers `401`.

## MCP server

The MCP server must accept a stateless `tools/call` request over Streamable HTTP with the protocol version `2026-07-28`, and expose two tools:

| Tool         | Arguments                                                                         | Keys              |
| ------------ | --------------------------------------------------------------------------------- | ----------------- |
| `remote`     | `{"button": "up" \| "down" \| "left" \| "right" \| "select" \| "menu" \| "home"}` | the seven buttons |
| `play_pause` | `{}`                                                                              | play/pause        |

A result with `isError: true` or with `structuredContent.success: false` counts as a failure.

## Development

The toolchain is pinned in `mise.toml`. Every command runs through mise:

| Command          | What it does                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `mise run check` | Format check, type check, tests and `streamdeck validate`. CI runs it on every pull request and on every push to `main`.               |
| `mise run build` | Compiles `src/` and bundles it into `com.pavel-karpovich.apple-tv.sdPlugin/bin/`.                                                      |
| `mise run pack`  | Builds `dist/com.pavel-karpovich.apple-tv.streamDeckPlugin`. `mise run pack 1.2.3` also writes version `1.2.3.0` into `manifest.json`. |

To try a local build, open the file from `dist/` in Stream Deck.

## Release

Push a tag `v<major>.<minor>.<patch>`, for example `v0.2.0`. The tag is the only source of the version: the `Version` in `manifest.json` in the repository is a placeholder. The release workflow runs the check, packs the plugin with the tag's version (`0.2.0.0` in the manifest) and publishes a GitHub release with the `.streamDeckPlugin` file. A tag with a suffix, such as `v0.2.0-beta.1`, fails the pack.
