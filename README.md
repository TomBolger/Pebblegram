# Pebblegram

Pebblegram brings Telegram to Pebble watches with a PebbleKit JS Telegram client. The watch app gives you a fast inbox, readable message threads, inline photo previews, canned replies, and dictation replies without a separate companion service.

![Chat list](store/screenshots/01-emery-chat-list.png)
![Messages](store/screenshots/02-emery-messages.png)
![Photo message](store/screenshots/03-emery-photo-message.png)
![Actions](store/screenshots/04-emery-action-list.png)

## Download

- [Download the Pebble app PBW](release/Pebblegram.pbw)

## What It Does

- Shows recent Telegram chats with unread state and message previews
- Opens one-on-one chats and regular groups
- Displays incoming and outgoing chat bubbles
- Loads inline photo previews
- Sends replies with Pebble dictation
- Sends configurable canned replies
- Loads older messages on demand
- Supports Basalt, Diorite, Emery, and Gabbro builds
- Includes a black-and-white optimized Diorite image path
- Includes round-screen layout handling for Gabbro

## Quick Start

1. Install [release/Pebblegram.pbw](release/Pebblegram.pbw) with the Pebble/Rebble mobile app.
2. Open Pebblegram settings in the Pebble mobile app.
3. Enter your Telegram API ID, API hash, and phone number.
4. Save once to request a Telegram login code.
5. Reopen settings, enter the login code, and save again.

Create Telegram API credentials at [my.telegram.org/apps](https://my.telegram.org/apps).

## Development

Install the Pebble SDK/tooling, then build:

```sh
pebble build
```

Build the bundled Telegram client:

```sh
npm install
npm run build:pgjs-gramjs
```

For local testing with embedded API credentials, keep them in an ignored environment file such as `.env.pgjs.local`, then source it before building the bundle. Do not commit personal API credentials, Telegram sessions, or generated PBWs that contain credentials.

## Project Structure

- `src/c/Pebblegram.c`: watch UI, AppMessage handling, scrolling, image decoding, actions, dictation
- `src/pkjs/index.js`: PebbleKit JS runtime and watch communication
- `src/pkjs/config.html`: Pebble settings page
- `src/pkjs/pgjs/`: Telegram client, auth, settings storage, and image processing
- `resources/images/menu_icon.png`: launcher/app-list icon bundled into the PBW
- `store/screenshots/`: store listing screenshots
- `release/`: packaged PBW

## Security Notes

- Do not commit `.env`, `.env.*`, Telegram session files, generated personal PBWs, ngrok configs, or account tokens.
- Public release builds must not embed a personal Telegram API ID or API hash.
- Telegram two-step verification is not supported yet.

## Status

Pebblegram 2.0 is the first direct Telegram build. The core flows work, but this is still community software for an unsupported watch platform.
