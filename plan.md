# PGJS Plan

PGJS is the internal codename for the PebblegramJS experiment. The goal is to
keep the watch UI identical to the 1.7 helper-backed app while replacing the
phone-side backend with GramJS running in PebbleKit JS. Main remains the stable
helper-backed release line; this work lives on `experiment/pgjs`.

## Architecture

- Keep `src/c/Pebblegram.c` and the AppMessage protocol stable.
- Make `src/pkjs/index.js` a dispatcher that talks to a backend object.
- Keep helper-mode code available as a fallback backend during the experiment.
- Add PGJS modules under `src/pkjs/pgjs/`:
  - `auth.js`: settings state, GramJS login, StringSession storage.
  - `telegram.js`: chat/message/send/delete/media operations.
  - `image.js`: media download and Pebble PNG preparation.
  - `cache.js`: localStorage and in-memory caching.
  - `backend.js`: AppMessage-shaped backend facade.

## Authentication

- The settings page collects Telegram API ID, API hash, and phone number.
- First save without a login code stores credentials and starts Telegram login,
  which should trigger Telegram to send a code.
- Reopen settings, enter the login code, and save again to complete login.
- If Telegram requires a cloud password, the same settings page accepts it.
- Store the GramJS StringSession in PebbleKit JS localStorage only.

## Image Pipeline

- PGJS requests Telegram media directly through GramJS.
- The initial path passes Telegram-provided PNG bytes through when possible.
- JPEG/other conversion is isolated in `pgjs/image.js` for the next spike.
  `jpeg-js` installs cleanly; `upng-js` is not currently usable because the
  Pebble SDK rejects its duplicate transitive dependency layout.
- Output remains PNG chunks over AppMessage, decoded by the existing C app.

## Current Status

- Branch created: `experiment/pgjs`.
- PGJS module structure is added and buildable without changing the C UI.
- Direct static `require("telegram")` is not viable as the first integration
  path; the dependency graph is too heavy for the Pebble SDK build.
- Declaring GramJS/image npm dependencies in `package.json` also blocks the
  Pebble SDK package pass, so dependencies stay out of the app manifest until
  the prebundle can be generated as app-owned source.
- The SDK webpack is v1 and cannot parse GramJS's package graph directly, so
  `tools/pgjs-gramjs-entry.js` now creates `src/pkjs/pgjs/gramjs.bundle.js`
  with esbuild. Dependencies stay installed with `npm install --no-save`.
- The bundle forces GramJS away from Node TCP/proxy code and into its
  WebSocket transport using shims in `src/pkjs/pgjs/shims/`.
- The GramJS entry bootstrap now creates a minimal browser-like `window`
  before loading Telegram modules so GramJS selects its WebSocket path instead
  of the Node TCP socket path inside PebbleKit JS.
- The PGJS branch uses a branch-hosted settings URL instead of the stable 1.7
  GitHub Pages settings page. Pebble config pages are opened by URL and are not
  bundled into the PBW.
- `pebble build` succeeds with the bundled GramJS code included. The PBW at
  `build/Pebblegram.pbw` is ready for the first on-phone runtime test.
- Known risk: PebbleKit JS may not expose a usable `WebSocket` constructor. If
  it does not, the current build will fail early with `WebSocket is not
  available in PebbleKit JS.`
- Known risk: a Pebble-compatible PNG encoder still needs to be chosen for
  non-PNG Telegram media.
- Known risk: the current media path only accepts Telegram media that already
  arrives as PNG bytes; JPEG conversion remains a later spike.

## Validation Targets

- `pebble build` succeeds on all configured platforms.
- Settings can save API ID/hash/phone/code/password.
- First launch without a helper service should show an auth/settings-required
  error rather than falling back to the helper.
- Saving API ID/hash/phone should trigger Telegram to send a login code.
- Saving the login code should persist the GramJS StringSession.
- PGJS can persist and restore a StringSession.
- Chat list and messages load without the helper service running.
- Images load through the existing watch-side chunk/decode path.
