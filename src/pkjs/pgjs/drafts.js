// Telegram draft syncing between the open watch chat and the other clients.
var SAVE_DELAY_MS = 600;
var ECHO_WINDOW_MS = 3000;
var MAX_DRAFT_BYTES = 399;

function parseDraft(raw) {
  var reply = raw && raw.replyTo;
  return {
    text: raw && typeof raw.message === 'string' ? raw.message : '',
    replyTo: reply && reply.replyToMsgId ? String(reply.replyToMsgId) : ''
  };
}

// deps: backend() -> {getDraft, saveDraft}, send(payload), keys (MessageKeys),
// isOpen(chatId), clamp(text, maxBytes), log(message), now().
function create(deps) {
  var lastSaved = {};
  var pending = {};

  function remember(chatId, text) {
    lastSaved[chatId] = {text: text, at: deps.now()};
  }

  function sendRow(chatId, draft) {
    var payload = {};
    payload[deps.keys.Type] = 'draft';
    payload[deps.keys.ChatId] = String(chatId);
    payload[deps.keys.Text] = deps.clamp(draft.text.replace(/\r\n?/g, '\n'), MAX_DRAFT_BYTES);
    if (draft.replyTo) {
      payload[deps.keys.ReplyTo] = draft.replyTo;
    }
    deps.send(payload);
  }

  // Called once the chat's message window has been sent.
  function sendOpenChatDraft(chatId) {
    deps.backend().getDraft(chatId).then(function(draft) {
      if (draft.text && deps.isOpen(chatId)) {
        sendRow(chatId, draft);
      }
    }).catch(function(err) {
      deps.log('Draft fetch failed: ' + (err && err.message ? err.message : err));
    });
  }

  function flushSave(chatId) {
    var request = pending[chatId];
    delete pending[chatId];
    remember(chatId, request.text);
    deps.backend().saveDraft(chatId, request.text, request.replyTo).catch(function(err) {
      deps.log('Draft save failed: ' + (err && err.message ? err.message : err));
    });
  }

  // Watch typed or cleared a draft; only the latest quick change is sent.
  function save(chatId, text, replyTo) {
    text = String(text || '');
    if (pending[chatId]) {
      clearTimeout(pending[chatId].timer);
    }
    pending[chatId] = {text: text, replyTo: replyTo, timer: setTimeout(function() {
      flushSave(chatId);
    }, SAVE_DELAY_MS)};
    remember(chatId, text);
  }

  // A sent message clears the draft on Telegram's side; drop any queued save.
  function sent(chatId) {
    if (pending[chatId]) {
      clearTimeout(pending[chatId].timer);
      delete pending[chatId];
    }
    remember(chatId, '');
  }

  function isEcho(chatId, draft) {
    var saved = lastSaved[chatId];
    return !!saved && saved.text === draft.text && deps.now() - saved.at < ECHO_WINDOW_MS;
  }

  // Returns true when the update was a draft update (handled here).
  function onUpdate(update, chatId) {
    var draft;
    if (!update || update.className !== 'UpdateDraftMessage') {
      return false;
    }
    draft = parseDraft(update.draft);
    if (chatId && deps.isOpen(chatId) && !isEcho(chatId, draft)) {
      sendRow(chatId, draft);
    }
    return true;
  }

  return {
    sendOpenChatDraft: sendOpenChatDraft,
    save: save,
    sent: sent,
    onUpdate: onUpdate
  };
}

module.exports = {
  parseDraft: parseDraft,
  create: create
};
