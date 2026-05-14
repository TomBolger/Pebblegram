# Pebblegram Polish and Optimization Pass

## Summary

First complete trimming and performance work on the current 2.1 line, then test
the app once before adding new features. After the lean 2.1 build is validated,
fork it into an experimental feature branch so polish features do not destabilize
the working build.

## Phase 1: Lean 2.1 Trimming and Optimization

- Stop packaging `pebble-js-app.js.map` in release PBWs; it is currently the
  largest PBW entry.
- Build `gramjs.bundle.js` with minification and without debug sourcemap or
  legal-comment bulk for release builds.
- Remove mock chat/message data, helper/bridge fallback code, and unused legacy
  paths now that the app is PGJS-only.
- Audit GramJS bundle imports for unused surfaces, especially upload, markdown,
  proxy/TCP, and unused media helpers.
- Add timing logs for connect, dialog fetch, message fetch, photo download,
  photo encode, and AppMessage transfer.
- Improve chat-list loading by reducing over-fetching, warming the Telegram
  connection early, and sending rows as soon as dialog data is available.
- Replace the misleading chat-list progress bar with staged real progress:
  connecting, fetching dialogs, sending rows, complete.
- Add PGJS-side prefetch for top chat messages after the chat list renders, but
  do not show stale cached message/chat text first.

## Phase 2: Validate Lean 2.1

- Build all target platforms and compare PBW contents before/after; confirm
  release PBWs omit source maps.
- Install and test the lean build once before feature work begins.
- Verify 2.1 still supports login/session restore, chat-list load, chat open,
  sending, deleting, older messages, and photo loading.
- Measure cold/warm connect, chat-list load, chat open, older-message fetch,
  photo load, and cached photo load.
- If this validation finds regressions, fix them on the 2.1 line before
  branching.

## Phase 3: Branch for Experimental Features

- After the lean 2.1 build passes the single validation round, create an
  experimental branch from that exact known-good state.
- Keep the lean 2.1 branch as the stable working build while feature work happens
  on the experimental branch.
- Do not merge feature work back until each feature group has been tested on
  watch hardware or emulator as appropriate.

## Experimental Small Effort Features

- Use a pale Telegram-like yellow background for incoming messages on color
  watches, preserving Diorite readability.
- Tune message-scroll animation constants and alignment for a faster Pebble
  Timeline-style snap.
- Show unread indicators in the chat list: blue circle with white count for real
  unread counts, blue dot with no number for manual unread state.
- Mark a chat as read after its messages open successfully.

## Experimental Medium Effort Features

- Add circular chat-list avatar placeholders with initials, drawn immediately
  with the chat rows.
- Load contact photos asynchronously over the placeholders so chat-list text is
  never blocked.
- Cache encoded contact photos only, using a small bounded LRU cache so repeat
  avatar loads are fast without moving chat rows around.
- Improve message photo speed by caching encoded photo PNG bytes by
  chat/message/size/colors.
- Improve photo tone mapping before PNG quantization with brightness/gamma lift
  to reduce crushed blacks.
- Refresh the open chat when new messages arrive using GramJS update events or a
  lightweight periodic poll if event delivery is unreliable.
- Add edit-message support to the selected-message action menu. It opens
  dictation directly, then uses the existing send confirmation flow before
  calling `client.editMessage`.
- Add long-press select on the chat list to open actions: `Archive Chat`,
  `Delete Chat`, `Mute Chat`, `Mark as Unread`, and `Go Back`.
- Implement chat actions with raw Telegram API calls where GramJS lacks
  convenience helpers: `folders.EditPeerFolders` for archive,
  `messages.MarkDialogUnread` for manual unread, `account.UpdateNotifySettings`
  for mute, and delete-history/delete-chat APIs for delete.
- Add confirmations for destructive chat delete and message edit/send
  operations.

## Earmarked for v3.0: Large Effort Findings

- Reply quotes remain v3.0 scope. GramJS exposes reply metadata
  (`message.replyTo.replyToMsgId`), but the current AppMessage protocol and
  watch `Message` struct do not carry quote fields.
- `View Full Quote` belongs with the v3.0 quote work. It is straightforward
  after quote text exists, but fetching quote text is harder because the
  replied-to message may not be in the loaded window.
- `Go To Quote` is the hardest v3.0 quote feature. If the quoted message is not
  loaded, the app must fetch older history until found or give up without
  disrupting the current scroll position.
- Notification suppression is v3.0 research. GramJS can mark chats read and
  receive updates, but Pebblegram likely cannot suppress notifications generated
  by the separate Telegram phone app.

## Assumptions

- Helper/bridge fallback support will be removed during Phase 1.
- Cached media is allowed; cached chat/message text should not be displayed
  before fresh data.
- Feature work waits until after the lean 2.1 validation and branch point.
- 2FA remains out of scope except avoiding changes that would interfere with
  later 2FA testing.
