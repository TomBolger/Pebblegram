# Pebblegram Roadmap Plan

## Summary

Current `main` is the stable 2.2 release line. New product work should happen on
experimental branches and merge back only after device testing. The next releases
are intentionally staged so media loading, reactions, quotes, and notifications
do not all destabilize the watch message model at once.

## 2.3: GIF Preview Support, Live Updates, And Low-Effort Polish

- Target GIF preview support as the primary 2.3 feature.
- Keep `[GIF]` in chat snippets and chat view until a preview image successfully
  loads.
- Load GIF previews through an isolated media-preview path that cannot leave
  regular photo loading blocked after success, failure, retry, or cancellation.
- Reuse the proven single-active-image transfer discipline from the 2.2 photo
  loader; do not introduce parallel image transfers for GIFs.
- Prefer Telegram-provided still previews/covers, including thumbnails attached
  to MP4-backed GIFs, at the same byte and heap limits as photos. Do not decode
  video frames in PKJS. If quality or stability is poor, keep GIFs text-only for
  2.3 rather than risking image-loader regressions.
- Add live incoming message handling as the other core 2.3 feature.
- Incoming messages should update the active chat without moving the selected
  message or viewport when the user is reading older or middle messages.
- If the user is at the compose/bottom position, new incoming messages may append
  and keep the view pinned to the bottom.
- If the user is browsing above the newest loaded window, preserve the current
  message id and scroll offset; surface new messages only when the user returns
  to bottom, refreshes, or otherwise requests the newest view.
- Reaction-only, edit-only, and media-status updates should update existing rows
  by message id without resetting image loading or scrolling.
- Increase maximum displayed message length by a few lines now that hold-to-scroll
  is fast enough to navigate longer bubbles comfortably.
- Include only low-effort polish that does not add new persistent state, expand
  the message protocol significantly, or increase watch memory pressure.

## 2.4: View Reactions

- Normalize Telegram `MessageReactions` into compact display text, limited to the
  top two or three emoji/count pairs.
- Add a small reaction summary field to the message payload and watch `Message`
  model.
- Draw reactions as a compact one-line footer in message bubbles.
- Update message signatures so reaction-only changes can refresh visible rows.
- Do not add reaction submission in 2.4.

## 2.5: Send Reactions

- Add a selected-message `React` action.
- Add a fixed emoji picker for common reactions: thumbs up, heart, laughing,
  surprised, sad, and pray/thanks.
- Send the selected reaction through a new PKJS command and Telegram/GramJS
  reaction call.
- Refresh the affected message or visible message window after submission.
- Handle unsupported reactions by showing a short watch status and leaving the
  existing message state unchanged.

## 2.6: Quote Logic

- Add reply/quote metadata to Telegram normalization and AppMessage payloads.
- Draw a one-line quote snippet above the message body.
- Add `View Full Quote` to the selected-message action menu.
- Add `Go To Quote` with older-history lookup and stable viewport anchoring.
- Reuse the message metadata, action-menu, and layout plumbing created for
  reaction display where practical.

## 2.7: Notifications

- Do not attempt to suppress stock Telegram notifications from Pebblegram. Users
  can disable or filter those through the Pebble phone app notification settings.
- Research whether Pebblegram PKJS can reliably observe Telegram updates while
  the watch app is not foregrounded.
- If background observation is reliable, generate Pebblegram-owned notifications
  for new messages and store the target chat id so launching Pebblegram opens the
  relevant chat.
- If background observation is unreliable, document the limitation and keep
  notifications out of the release rather than shipping inconsistent behavior.

## Shared Implementation Notes

- Reactions and quotes both expand per-message metadata, AppMessage keys, bubble
  layout, and selected-message actions. Keep each field compact because every
  added byte is multiplied by the platform message row count.
- GIF previews and photos must share one coherent transfer scheduler so stale
  media transfers cannot block visible selected media.
- Live updates must merge rows by Telegram message id. Avoid full-window
  replacement except for explicit refreshes, opening a chat, and older-history
  pagination.
- Every release should build all targets and include device testing on
  image-heavy chats before merging back to `main`.
