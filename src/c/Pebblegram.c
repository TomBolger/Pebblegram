#include <pebble.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include "message_keys.auto.h"

#define MAX_CHATS 20
#define MAX_MESSAGES 9
#define MAX_TEXT 460
#define MAX_FULL_TEXT 1200
#define MESSAGE_PREVIEW_TEXT PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 132, 132, 132, 132, 220, 132, 220)
#define MAX_SENDER 36
#define MAX_REACTIONS 64
#define REACTION_LINE_H 17
#define REACTION_MAX_LINES 3
#define MAX_META 16
#define MAX_CONTEXT_TEXT PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 60, 60, 60, 56, 72, 56, 64)
#define MAX_ID 24
#define MAX_IMAGE_ERROR 32
#define MAX_IMAGE_BYTES PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 13000, 9500, 9500, 8500, 40000, 8500, 23000)
#define MAX_AVATAR_BYTES PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 3000, 3000, 3000, 2200, 3000, 2200, 3000)
#define MAX_LOADED_IMAGES 1
#define IMAGE_THUMB_SIZE PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 132, 108, 108, 108, 198, 108, 144)
#define IMAGE_FRAME_EXTRA_W PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 10, 8, 8, 6, 14, 6, 10)
#define APP_INBOX_SIZE 2048
#define APP_OUTBOX_SIZE PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 512, 512, 512, 512, 1024, 512, 1024)
#define BW_UI PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 0, 0, 0, 1, 0, 1, 0)
#define ROUND_UI PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 0, 0, 0, 0, 0, 0, 1)
#define STATUS_H PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 24, 24, 24, 24, 24, 24, 22)
#define MAX_CANNED 10
#define CANNED_TEXT_LEN 40
#define PG_MIN(a, b) ((a) < (b) ? (a) : (b))
#define PG_MAX(a, b) ((a) > (b) ? (a) : (b))
#define APP_COLOR GColorCobaltBlue
#define APP_COLOR_LIGHT GColorCobaltBlue
#define UNREAD_COLOR GColorPictonBlue
#define CHAT_BG GColorWhite
#define IN_BUBBLE GColorPastelYellow
#define OUT_BUBBLE GColorCeleste
#define IN_CONTEXT_BUBBLE GColorIcterine
#define OUT_CONTEXT_BUBBLE GColorCadetBlue
#define SELECTED_IN_BUBBLE GColorLightGray
#define SELECTED_OUT_BUBBLE GColorPictonBlue
#define ACTION_BG GColorBlack
#define ACTION_TEXT GColorDarkGray
#define ACTION_TEXT_SELECTED GColorWhite
#define CHAT_SCROLL_STEPS 4
#define CHAT_SCROLL_FRAME_MS 2
#define CHAT_SCROLL_DELTA 30
#define REPEAT_SCROLL_MS 140
#define MESSAGE_MODE_INITIAL 0
#define MESSAGE_MODE_OLDER 1
#define MESSAGE_MODE_NEWER 2
#define LONG_MESSAGE_SCROLL_DELTA PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 42, 42, 42, 42, 56, 42, 48)
#define COMPOSE_BUBBLE_H 30
#define COMPOSE_BUBBLE_GAP 8
#define MESSAGE_COMMAND_RETRY_MS 3000
#define MESSAGE_COMMAND_WAKE_RETRY_MS 650
#define MESSAGE_COMMAND_MAX_ATTEMPTS 3
#define MESSAGE_TRANSFER_TIMEOUT_MS 20000
#define IMAGE_COMMAND_RETRY_MS 350
#define IMAGE_PREPARE_STALL_MS 30000
#define IMAGE_TRANSFER_STALL_MS 12000
#define CHAT_COMMAND_WAKE_RETRY_MS 700
#define CHAT_COMMAND_MAX_ATTEMPTS 4
#define CHAT_FIRST_PAINT_ROWS PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 3, 3, 3, 3, 5, 3, 5)
#define PHONE_WAKE_DELAY_MS 180
#define IMAGE_KEEP_SCREEN_MARGIN 48
#define IMAGE_LOAD_SCREEN_MARGIN 24
#define IMAGE_TALL_MAX_MULTIPLIER 2
#define IMAGE_DECODE_HEADROOM_BYTES 12000
#define IMAGE_DECODE_HEADROOM_PIXELS 16000
#define IMAGE_DECODE_FINAL_HEADROOM_BYTES PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 8000, 7000, 7000, 6000, 10000, 6000, 8000)
#define IMAGE_DECODE_MAX_DIMENSION 512
#define IMAGE_RETRY_MAX_LEVEL 3
#define IMAGE_DIAG_LOGS 0
#define STATUS_CLEAR_MS 1000
#define VIEW_TRANSITION_MS 120
#define TOUCH_KEYBOARD_ENABLED 1
#define TOUCH_KEYBOARD_MAX_TEXT 400
#ifdef _PBL_API_EXISTS_touch_service_subscribe
#define TOUCH_KEYBOARD_AVAILABLE 1
#else
#define TOUCH_KEYBOARD_AVAILABLE 0
#endif

#if IMAGE_DIAG_LOGS
#define IMAGE_DIAG(...) APP_LOG(APP_LOG_LEVEL_INFO, __VA_ARGS__)
#else
#define IMAGE_DIAG(...)
#endif

// Platform constants are centralized here. Basalt/Diorite stay conservative on
// heap use; Emery/Gabbro can afford longer text and larger image payloads.
typedef enum {
  ViewStateChatList,
  ViewStateChat
} ViewState;

typedef enum {
  ActionMenuMain,
  ActionMenuChat,
  ActionMenuCanned,
  ActionMenuConfirm,
  ActionMenuReply,
  ActionMenuReactionGrid,
  ActionMenuEmojiReplyGrid,
  ActionMenuFullText
} ActionMenuMode;

typedef enum {
  ActionItemCompose,
  ActionItemCanned,
  ActionItemReply,
  ActionItemReplyDictate,
  ActionItemReplyCanned,
  ActionItemReplyEmoji,
  ActionItemEmoji,
  ActionItemReact,
  ActionItemEdit,
  ActionItemDelete,
  ActionItemFullText,
  ActionItemFullContext,
  ActionItemGoToBottom,
  ActionItemArchiveChat,
  ActionItemDeleteChat,
  ActionItemMuteChat,
  ActionItemMarkUnread,
  ActionItemGoBack,
  ActionItemConfirmSend,
  ActionItemConfirmCancel,
  ActionItemKeyboard,
  ActionItemReplyKeyboard,
  ActionItemEditKeyboard
} ActionItem;

typedef enum {
  KeyboardModeCompose,
  KeyboardModeReply,
  KeyboardModeEdit
} KeyboardMode;

typedef struct {
  char id[MAX_ID];
  char *string_storage;
  char *title;
  char *preview;
  bool unread;
  int unread_count;
  GBitmap *avatar_bitmap;
} Chat;

typedef struct {
  char id[MAX_ID];
  char *string_storage;
  char *sender;
  char *text;
  char *reactions;
  char *meta;
  char *context;
  char image_token[MAX_ID];
  char image_error[MAX_IMAGE_ERROR];
  bool outgoing;
  bool image_placeholder;
  bool image_requested;
  bool image_failed;
  uint8_t image_progress;
  uint8_t image_retry_level;
  uint16_t image_width;
  uint16_t image_height;
  GBitmap *image_bitmap;
  uint8_t *image_data;
} Message;

// Telegram standard reactions the watch can draw, most popular first.
// PebbleOS 4.29+ has a much larger emoji font than older firmware.
static const char *const REACTION_CHOICES_EXPANDED[] = {
  "👍", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯",
  "😱", "🤬", "😢", "🎉", "🤩", "🤮", "💩", "🙏",
  "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "🌚",
  "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨",
  "😐", "🍓", "🍾", "💋", "🖕", "😈", "😴", "😭",
  "🤓", "👻", "👀", "🎃", "🙈", "😇", "😨", "🤝",
  "✍", "🤗", "🫡", "🎅", "🎄", "☃", "💅", "🤪",
  "🗿", "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊",
  "😎", "👾", "🤷", "😡", "👎"
};
static const char *const REACTION_CHOICES_CLASSIC[] = {
  "👍", "❤", "🥰", "👏", "😁", "😱", "🤬", "😢",
  "🎉", "🤩", "🤮", "💩", "🙏", "👌", "😍", "💯",
  "🤣", "💔", "😐", "💋", "😈", "😴", "😭", "👀",
  "😇", "😨", "🤝", "🤗", "🤪", "💘", "😘", "😎",
  "😡", "👎"
};

// Emoji offered as quick replies.
static const char *const EMOJI_REPLY_CHOICES_EXPANDED[] = {
  "👍", "👎", "❤", "😂", "🤣", "😊", "🙂", "😉",
  "😍", "🥰", "😘", "😎", "🤔", "🙄", "😅", "😬",
  "😐", "😴", "😢", "😭", "😱", "😡", "🤯", "🥺",
  "🥹", "🫠", "🤗", "🫡", "🤷", "🙏", "👏", "🙌",
  "👌", "✌", "🤞", "👋", "💪", "👀", "🔥", "✨",
  "🎉", "🥳", "💯", "✅", "❌", "❓", "❗", "⭐",
  "💔", "💕", "🤝", "🍻", "☕", "🍕", "🎂", "🎁",
  "🚗", "🏠", "💤", "🕐", "🆗", "😀", "😃", "😄",
  "😁", "😇", "😈", "🤪", "🤩", "🤓", "😷", "🤒",
  "🤢", "🤮", "💩", "👻", "🙈", "😺", "🐶", "🌞",
  "🌙", "⚡", "🌈", "☔"
};
static const char *const EMOJI_REPLY_CHOICES_CLASSIC[] = {
  "👍", "👎", "❤", "😂", "🤣", "😊", "😉", "😍",
  "🥰", "😘", "😎", "🙄", "😅", "😬", "😐", "😴",
  "😢", "😭", "😱", "😡", "🥺", "🤗", "🙏", "👏",
  "🙌", "👌", "✌", "👋", "👀", "✨", "🎉", "💯",
  "✅", "❗", "⭐", "💔", "💕", "🤝", "🍻", "😀",
  "😃", "😄", "😁", "😇", "😈", "🤪", "🤩", "😷",
  "🤮", "💩", "🌙"
};

static Window *s_main_window;
static MenuLayer *s_chat_menu;
static TextLayer *s_status_layer;
static Layer *s_messages_root;
static PropertyAnimation *s_chat_menu_animation;
static PropertyAnimation *s_messages_animation;

static Window *s_action_window;
static Layer *s_action_layer;
static ActionMenu *s_native_action_menu;
static ActionMenuLevel *s_native_action_root;
static ActionMenuMode s_action_mode;
static ActionMenuMode s_native_deferred_mode;
static int s_action_selected;
static int s_full_text_scroll_offset;
static int s_full_text_height;
static bool s_full_text_context;
static bool s_native_has_deferred_mode;
static bool s_native_deferred_dictation;
static int s_native_deferred_keyboard = -1;
static char s_native_deferred_keyboard_target[MAX_ID];
static char s_full_text_title[MAX_SENDER + 10];
static char *s_full_text_body;

static DictationSession *s_dictation_session;

static Chat s_chats[MAX_CHATS];
static Message s_messages[MAX_MESSAGES];
static Message *s_message_stage;
static int s_message_y[MAX_MESSAGES];
static int s_message_h[MAX_MESSAGES];
static int s_compose_bubble_y;
static uint8_t *s_image_buffer;
static uint8_t *s_avatar_buffer;
static uint16_t s_image_buffer_capacity;
static uint16_t s_avatar_buffer_capacity;
static char s_image_message_id[MAX_ID];
static char s_selected_image_focus_id[MAX_ID];
static char s_avatar_chat_id[MAX_ID];
static int s_image_size;
static int s_image_received;
static int s_image_expected_offset;
static int s_image_transfer_id;
static bool s_image_is_pbi;
static int s_avatar_size;
static int s_avatar_received;
static int s_avatar_expected_offset;
static int s_avatar_transfer_id;
static int s_loaded_image_count;
static char s_canned[MAX_CANNED][CANNED_TEXT_LEN] = {
  "Yes",
  "No",
  "On my way",
  "Call you later",
  "Thanks",
  "",
  "",
  "",
  "",
  ""
};
static char s_pending_text[MAX_TEXT];
static char s_pending_edit_message_id[MAX_ID];
static char s_pending_chat_command[24];
static bool s_pending_send_as_reply;
static bool s_touch_keyboard_open;
#if TOUCH_KEYBOARD_AVAILABLE
static bool s_touch_keyboard_symbols;
static bool s_touch_keyboard_shift;
#endif
static char s_touch_keyboard_sent_text[TOUCH_KEYBOARD_MAX_TEXT];
static char s_current_chat_id[MAX_ID];
static char s_current_chat_title[48];
static char s_status_text[64];
static char s_loading_text[96] = "Loading...";
static char s_chat_refresh_selected_id[MAX_ID];
static char s_chat_list_selected_id[MAX_ID];

static int s_chat_count;
static int s_message_count;
static int s_selected_chat;
static int s_selected_message;
static int s_expected_rows;
static int s_message_transfer_id;
static int s_message_stream_mode;
static int s_message_stage_count;
static int s_chat_scroll_offset;
static int s_chat_scroll_start;
static int s_chat_scroll_target;
static int s_chat_scroll_step;
static int s_chat_content_height;
static int s_message_scroll_direction;
static ViewState s_view_state;
static bool s_bridge_ready;
static bool s_chats_loading;
static bool s_chat_first_paint_reported;
static bool s_loading_error;
static bool s_chat_view_pending;
static bool s_loading_messages;
static bool s_loading_older_messages;
static bool s_loading_newer_messages;
static bool s_user_scrolled_messages;
static bool s_at_newest;
static bool s_at_oldest;
static bool s_message_stream_silent;
static int s_chat_loading_progress;
static int s_older_anchor_y;
static int s_newer_anchor_y;
static char s_older_anchor_id[MAX_ID];
static char s_newer_anchor_id[MAX_ID];
static AppTimer *s_chat_scroll_timer;
static AppTimer *s_message_timeout_timer;
static AppTimer *s_message_retry_timer;
static AppTimer *s_image_retry_timer;
static AppTimer *s_status_clear_timer;
static AppTimer *s_chat_retry_timer;
static AppTimer *s_startup_wake_timer;
static int s_message_request_attempts;
static int s_chat_request_attempts;

static void request_chats(void);
static void request_messages(const char *chat_id);
static void request_next_image(void);
static void startup_wake_timer_callback(void *data);
static void chat_retry_timer_callback(void *data);
static void clear_active_image_request(void);
static bool selected_message_needs_image(void);
static void image_retry_timer_callback(void *data);
static void request_older_messages(bool silent);
static void request_newer_messages(bool silent);
static void refresh_loaded_image_count(void);
static void destroy_message_images(void);
static void destroy_offscreen_message_images(void);
static bool destroy_unselected_loaded_image(void);
static void main_back_click_handler(ClickRecognizerRef recognizer, void *context);
static void send_text_message(const char *text, bool as_reply);
static void edit_selected_message(const char *text);
static void delete_selected_message(void);
static void send_selected_chat_action(const char *command);
static void select_chat_row(int row, bool animated);
static void remove_chat_at(int row);
static void destroy_chat_avatars(void);
static void mask_avatar_corners(GContext *ctx, GPoint center, int radius, GColor bg_color);
static void render_messages(void);
static void preserve_stream_anchor(const char *anchor_id, int anchor_y, bool dirty);
static void show_chat_view_timer(void *data);
static void message_timeout_timer_callback(void *data);
static void cancel_message_timeout(void);
static void cancel_message_retry(void);
static void schedule_message_timeout(void);
static void schedule_message_send_retry(void);
static void show_status(const char *message);
static void status_clear_timer_callback(void *data);
static const char *default_status_text(void);
static bool send_command_with_status(const char *command, const char *chat_id, const char *text,
                                     const char *reply_to, const char *message_id, bool show_failures);
static void show_loading_text(const char *message, bool is_error);
static void click_config_provider(void *context);
static void copy_cstr(char *dest, size_t dest_size, const char *src);
static int message_reaction_height(Message *message, int text_w);
static void show_action_window(ActionMenuMode mode);
static void start_dictation(void);
static void action_click_config_provider(void *context);
static void action_window_unload(Window *window);
#if TOUCH_KEYBOARD_AVAILABLE
static int touch_keyboard_viewport_height(GRect bounds);
static void touch_handler(const TouchEvent *event, void *context);
#endif
static bool touch_keyboard_supported(void);
static void close_touch_keyboard(void);
static void reset_touch_keyboard(void);
static void open_touch_keyboard(KeyboardMode mode, const char *target_id, const char *initial_text);
static void touch_keyboard_send_result(bool ok);
static bool touch_keyboard_has_draft(void);
static int find_message_index_by_id(const char *id);
static void remove_message_at(int index);
static void set_chat_scroll_offset(int offset, bool animated);
static GRect compose_rect_for_bounds(GRect bounds);
static bool selected_message_is_truncated(void);
static bool selected_message_has_context(void);
static bool has_selected_message(void);
static bool compose_target_is_selected(void);
static void recalc_message_layout(void);
static void scroll_to_bottom(bool animated);
static void go_to_bottom(void);
static void set_chat_scroll_offset(int target, bool animated);
static void set_chat_scroll_offset_quiet(int target);
static void select_message_with_alignment(int index, bool align_top, bool animated);
static void chat_scroll_timer_callback(void *data);
static void messages_root_update_proc(Layer *layer, GContext *ctx);

static void update_canned_replies(const char *packed) {
  if (!packed || !packed[0]) {
    return;
  }

  char buffer[MAX_CANNED * CANNED_TEXT_LEN];
  copy_cstr(buffer, sizeof(buffer), packed);
  for (int i = 0; i < MAX_CANNED; i++) {
    s_canned[i][0] = '\0';
  }

  char *cursor = buffer;
  for (int i = 0; i < MAX_CANNED; i++) {
    char *separator = strchr(cursor, '|');
    if (separator) {
      *separator = '\0';
    }
    if (cursor[0]) {
      copy_cstr(s_canned[i], sizeof(s_canned[i]), cursor);
    }
    if (!separator) {
      break;
    }
    cursor = separator + 1;
  }
}

static int canned_reply_count(void) {
  int count = 0;
  for (int i = 0; i < MAX_CANNED; i++) {
    if (s_canned[i][0]) {
      count++;
    }
  }
  return PG_MAX(1, count);
}

static int utf8_expected_bytes(unsigned char lead) {
  if (lead < 0x80) {
    return 1;
  }
  if ((lead & 0xe0) == 0xc0) {
    return 2;
  }
  if ((lead & 0xf0) == 0xe0) {
    return 3;
  }
  if ((lead & 0xf8) == 0xf0) {
    return 4;
  }
  return 0;
}

static void trim_incomplete_utf8(char *text) {
  size_t len;
  size_t lead;
  int expected;
  if (!text || !text[0]) {
    return;
  }
  len = strlen(text);
  lead = len;
  while (lead > 0 && (((unsigned char)text[lead - 1] & 0xc0) == 0x80)) {
    lead--;
  }
  if (lead == len) {
    expected = utf8_expected_bytes((unsigned char)text[len - 1]);
    if (expected == 1) {
      return;
    }
    if (expected == 0 || len - 1 + (size_t)expected > len) {
      text[len - 1] = '\0';
    }
    return;
  }
  if (lead == 0) {
    text[0] = '\0';
    return;
  }
  expected = utf8_expected_bytes((unsigned char)text[lead - 1]);
  if (expected == 0 || lead - 1 + (size_t)expected > len) {
    text[lead - 1] = '\0';
  }
}

// Pebble's string helpers do not consistently protect callers from NULL input.
static void copy_cstr(char *dest, size_t dest_size, const char *src) {
  if (!dest || dest_size == 0) {
    return;
  }
  if (!src) {
    dest[0] = '\0';
    return;
  }
  strncpy(dest, src, dest_size - 1);
  dest[dest_size - 1] = '\0';
  trim_incomplete_utf8(dest);
}

static bool text_matches_ignoring_trailing_space(const char *a, const char *b) {
  if (!a || !b) {
    return false;
  }
  size_t la = strlen(a);
  size_t lb = strlen(b);
  while (la > 0 && (a[la - 1] == ' ' || a[la - 1] == '\n')) {
    la--;
  }
  while (lb > 0 && (b[lb - 1] == ' ' || b[lb - 1] == '\n')) {
    lb--;
  }
  return la == lb && strncmp(a, b, la) == 0;
}

static char s_empty_message_string[] = "";

static void release_message_strings(Message *message);

static size_t bounded_string_len(const char *src, size_t max_size) {
  size_t len;
  if (!src || !src[0] || max_size == 0) {
    return 0;
  }
  len = strlen(src);
  if (len >= max_size) {
    len = max_size - 1;
  }
  return len;
}

static char *pack_message_string(char **cursor, const char *src, size_t len) {
  char *dest;
  if (!cursor || !*cursor || !src || !src[0] || len == 0) {
    return s_empty_message_string;
  }
  dest = *cursor;
  memcpy(dest, src, len);
  dest[len] = '\0';
  trim_incomplete_utf8(dest);
  *cursor += len + 1;
  return dest[0] ? dest : s_empty_message_string;
}

static bool set_message_strings(Message *message, const char *sender, const char *text,
                                const char *reactions, const char *meta, const char *context) {
  size_t sender_len = bounded_string_len(sender, MAX_SENDER);
  size_t text_len = bounded_string_len(text, MAX_TEXT);
  size_t reactions_len = bounded_string_len(reactions, MAX_REACTIONS);
  size_t meta_len = bounded_string_len(meta, MAX_META);
  size_t context_len = bounded_string_len(context, MAX_CONTEXT_TEXT);
  size_t total = (sender_len ? sender_len + 1 : 0) +
                 (text_len ? text_len + 1 : 0) +
                 (reactions_len ? reactions_len + 1 : 0) +
                 (meta_len ? meta_len + 1 : 0) +
                 (context_len ? context_len + 1 : 0);
  char *storage = total ? malloc(total) : NULL;
  char *cursor = storage;
  if (!message) {
    if (storage) {
      free(storage);
    }
    return false;
  }
  release_message_strings(message);
  if (total && !storage) {
    return false;
  }
  message->string_storage = storage;
  message->sender = pack_message_string(&cursor, sender, sender_len);
  message->text = pack_message_string(&cursor, text, text_len);
  message->reactions = pack_message_string(&cursor, reactions, reactions_len);
  message->meta = pack_message_string(&cursor, meta, meta_len);
  message->context = pack_message_string(&cursor, context, context_len);
  return true;
}

static void init_message_strings(Message *message) {
  if (!message) {
    return;
  }
  message->string_storage = NULL;
  message->sender = s_empty_message_string;
  message->text = s_empty_message_string;
  message->reactions = s_empty_message_string;
  message->meta = s_empty_message_string;
  message->context = s_empty_message_string;
}

static void release_message_strings(Message *message) {
  if (!message) {
    return;
  }
  if (message->string_storage) {
    free(message->string_storage);
    message->string_storage = NULL;
  }
  message->sender = s_empty_message_string;
  message->text = s_empty_message_string;
  message->reactions = s_empty_message_string;
  message->meta = s_empty_message_string;
  message->context = s_empty_message_string;
}

static void truncate_cstr_bytes(char *text, size_t size, size_t max_bytes, const char *suffix) {
  size_t suffix_len = suffix ? strlen(suffix) : 0;
  size_t cut;
  if (!text || size == 0 || strlen(text) <= max_bytes || max_bytes + 1 > size) {
    return;
  }
  cut = max_bytes > suffix_len ? max_bytes - suffix_len : 0;
  text[cut] = '\0';
  trim_incomplete_utf8(text);
  if (suffix_len && strlen(text) + suffix_len < size) {
    strncat(text, suffix, size - strlen(text) - 1);
  }
}

static char *tuple_cstring(DictionaryIterator *iter, uint32_t key) {
  Tuple *tuple = dict_find(iter, key);
  return tuple ? tuple->value->cstring : NULL;
}

static int tuple_int(DictionaryIterator *iter, uint32_t key, int fallback) {
  Tuple *tuple = dict_find(iter, key);
  return tuple ? (int)tuple->value->int32 : fallback;
}

// Round screens need a narrower central column so rows stay clear of corners.
static GRect round_safe_rect(GRect bounds) {
  if (!ROUND_UI) {
    return bounds;
  }
  int inset = bounds.size.w >= 180 ? 28 : 22;
  return GRect(inset, bounds.origin.y, bounds.size.w - (inset * 2), bounds.size.h);
}

static int message_side_inset(GRect bounds) {
  return ROUND_UI ? PG_MAX(28, bounds.size.w / 7) : 3;
}

static int message_bubble_width(GRect bounds) {
  if (ROUND_UI) {
    return PG_MAX(112, bounds.size.w - (message_side_inset(bounds) * 2));
  }
  return bounds.size.w - 14;
}

static int message_image_frame_width(int bubble_w) {
  return PG_MIN(IMAGE_THUMB_SIZE + IMAGE_FRAME_EXTRA_W, bubble_w - 10);
}

static int chat_status_y(void) {
  return ROUND_UI ? 6 : 0;
}

static int chat_content_y(void) {
  return ROUND_UI ? 48 : STATUS_H;
}

static int chat_bottom_pad(void) {
  return ROUND_UI ? 24 : 0;
}

static void chat_initials(const char *title, char *initials, size_t initials_size) {
  initials[0] = '\0';
  if (!title || !title[0] || initials_size < 2) {
    return;
  }
  initials[0] = toupper((unsigned char)title[0]);
  initials[1] = '\0';
  for (int i = 1; title[i] && initials_size > 2; i++) {
    if (title[i - 1] == ' ' && title[i] != ' ') {
      initials[1] = toupper((unsigned char)title[i]);
      initials[2] = '\0';
      return;
    }
  }
}

static Message *find_message_by_id(const char *message_id) {
  if (!message_id || !message_id[0]) {
    return NULL;
  }
  for (int i = 0; i < s_message_count; i++) {
    if (strcmp(s_messages[i].id, message_id) == 0) {
      return &s_messages[i];
    }
  }
  return NULL;
}

static Message *find_message_by_image_token(const char *image_token) {
  if (!image_token || !image_token[0]) {
    return NULL;
  }
  for (int i = 0; i < s_message_count; i++) {
    if (strcmp(s_messages[i].image_token, image_token) == 0) {
      return &s_messages[i];
    }
  }
  return find_message_by_id(image_token);
}

static int find_message_index_by_id(const char *message_id) {
  if (!message_id || !message_id[0]) {
    return -1;
  }
  for (int i = 0; i < s_message_count; i++) {
    if (strcmp(s_messages[i].id, message_id) == 0) {
      return i;
    }
  }
  return -1;
}

static bool message_stage_contains_id(const char *message_id) {
  if (!s_message_stage || !message_id || !message_id[0]) {
    return false;
  }
  for (int i = 0; i < s_message_stage_count; i++) {
    if (strcmp(s_message_stage[i].id, message_id) == 0) {
      return true;
    }
  }
  return false;
}

static int find_chat_index_by_id(const char *chat_id) {
  if (!chat_id || !chat_id[0]) {
    return -1;
  }
  for (int i = 0; i < s_chat_count; i++) {
    if (strcmp(s_chats[i].id, chat_id) == 0) {
      return i;
    }
  }
  return -1;
}

static void free_image_transfer_buffer(void) {
  if (s_image_buffer) {
    free(s_image_buffer);
    s_image_buffer = NULL;
  }
  s_image_buffer_capacity = 0;
}

static void free_avatar_transfer_buffer(void) {
  if (s_avatar_buffer) {
    free(s_avatar_buffer);
    s_avatar_buffer = NULL;
  }
  s_avatar_buffer_capacity = 0;
}

static bool ensure_transfer_buffer(uint8_t **buffer, uint16_t *capacity,
                                   int size, int max_size) {
  if (size <= 0 || size > max_size) {
    return false;
  }
  if (*buffer && *capacity >= size) {
    return true;
  }
  if (*buffer) {
    free(*buffer);
    *buffer = NULL;
    *capacity = 0;
  }
  *buffer = malloc(size);
  if (!*buffer) {
    return false;
  }
  *capacity = (uint16_t)size;
  return true;
}

static bool ensure_image_transfer_buffer(int image_size) {
  return ensure_transfer_buffer(&s_image_buffer, &s_image_buffer_capacity,
                                image_size, MAX_IMAGE_BYTES);
}

static bool ensure_avatar_transfer_buffer(int image_size) {
  return ensure_transfer_buffer(&s_avatar_buffer, &s_avatar_buffer_capacity,
                                image_size, MAX_AVATAR_BYTES);
}

static void reset_image_transfer_state(void) {
  free_image_transfer_buffer();
  s_image_message_id[0] = '\0';
  s_image_size = 0;
  s_image_received = 0;
  s_image_expected_offset = 0;
  s_image_transfer_id = 0;
  s_image_is_pbi = false;
}

static void reset_avatar_transfer_state(void) {
  free_avatar_transfer_buffer();
  s_avatar_chat_id[0] = '\0';
  s_avatar_size = 0;
  s_avatar_received = 0;
  s_avatar_expected_offset = 0;
  s_avatar_transfer_id = 0;
}

static bool transfer_chunk_fits(int offset, int length, int expected_offset,
                                int total_size, int capacity) {
  return offset == expected_offset &&
         offset >= 0 &&
         length > 0 &&
         total_size > 0 &&
         capacity >= total_size &&
         offset <= total_size &&
         length <= total_size - offset &&
         length <= capacity - offset;
}

static bool ensure_full_text_body(void) {
  if (s_full_text_body) {
    return true;
  }
  s_full_text_body = malloc(MAX_FULL_TEXT);
  if (!s_full_text_body) {
    return false;
  }
  s_full_text_body[0] = '\0';
  return true;
}

static void free_full_text_body(void) {
  if (s_full_text_body) {
    free(s_full_text_body);
    s_full_text_body = NULL;
  }
}

static void init_chat_strings(Chat *chat) {
  if (!chat) {
    return;
  }
  chat->string_storage = NULL;
  chat->title = s_empty_message_string;
  chat->preview = s_empty_message_string;
}

static void release_chat_strings(Chat *chat) {
  if (!chat) {
    return;
  }
  if (chat->string_storage) {
    free(chat->string_storage);
    chat->string_storage = NULL;
  }
  chat->title = s_empty_message_string;
  chat->preview = s_empty_message_string;
}

static bool set_chat_strings(Chat *chat, const char *title, const char *preview) {
  size_t title_len = bounded_string_len(title, 48);
  size_t preview_len = bounded_string_len(preview, 72);
  size_t total = (title_len ? title_len + 1 : 0) +
                 (preview_len ? preview_len + 1 : 0);
  char *storage = total ? malloc(total) : NULL;
  char *cursor = storage;
  if (!chat) {
    if (storage) {
      free(storage);
    }
    return false;
  }
  release_chat_strings(chat);
  if (total && !storage) {
    return false;
  }
  chat->string_storage = storage;
  chat->title = pack_message_string(&cursor, title, title_len);
  chat->preview = pack_message_string(&cursor, preview, preview_len);
  return true;
}

static void destroy_chat_avatar(Chat *chat) {
  if (chat && chat->avatar_bitmap) {
    gbitmap_destroy(chat->avatar_bitmap);
    chat->avatar_bitmap = NULL;
  }
}

static void clear_chat_slot(Chat *chat) {
  if (!chat) {
    return;
  }
  destroy_chat_avatar(chat);
  release_chat_strings(chat);
  memset(chat, 0, sizeof(Chat));
  init_chat_strings(chat);
}

static void preserve_chat_avatar(Chat *chat, const char *incoming_id) {
  int existing_index = find_chat_index_by_id(incoming_id);
  if (existing_index < 0 || &s_chats[existing_index] == chat) {
    destroy_chat_avatar(chat);
    return;
  }
  Chat moved = s_chats[existing_index];
  s_chats[existing_index] = *chat;
  *chat = moved;
}

static void destroy_chat_avatars(void) {
  for (int i = 0; i < MAX_CHATS; i++) {
    clear_chat_slot(&s_chats[i]);
  }
  s_chat_count = 0;
  reset_avatar_transfer_state();
}

static void mask_avatar_corners(GContext *ctx, GPoint center, int radius, GColor bg_color) {
  graphics_context_set_fill_color(ctx, bg_color);
  for (int y = -radius; y <= radius; y++) {
    int extent = 0;
    while ((extent + 1) * (extent + 1) + y * y <= radius * radius) {
      extent++;
    }
    int corner_w = radius - extent;
    if (corner_w > 0) {
      graphics_fill_rect(ctx, GRect(center.x - radius, center.y + y, corner_w, 1), 0, GCornerNone);
      graphics_fill_rect(ctx, GRect(center.x + extent + 1, center.y + y, corner_w, 1), 0, GCornerNone);
    }
  }
}

static void destroy_message_bitmap(Message *message) {
  if (message && message->image_bitmap) {
    gbitmap_destroy(message->image_bitmap);
    message->image_bitmap = NULL;
    message->image_requested = false;
    if (s_loaded_image_count > 0) {
      s_loaded_image_count--;
    }
  }
  if (message && message->image_data) {
    free(message->image_data);
    message->image_data = NULL;
  }
}

static void refresh_loaded_image_count(void) {
  s_loaded_image_count = 0;
  for (int i = 0; i < MAX_MESSAGES; i++) {
    if (s_messages[i].image_bitmap) {
      s_loaded_image_count++;
    }
  }
}

static void destroy_other_message_images(Message *keep) {
  for (int i = 0; i < MAX_MESSAGES; i++) {
    if (&s_messages[i] != keep) {
      destroy_message_bitmap(&s_messages[i]);
    }
  }
  refresh_loaded_image_count();
}

static void destroy_message_images(void) {
  if (s_image_retry_timer) {
    app_timer_cancel(s_image_retry_timer);
    s_image_retry_timer = NULL;
  }
  for (int i = 0; i < MAX_MESSAGES; i++) {
    destroy_message_bitmap(&s_messages[i]);
    s_messages[i].image_requested = false;
    s_messages[i].image_failed = false;
    s_messages[i].image_error[0] = '\0';
    s_messages[i].image_progress = 0;
  }
  s_loaded_image_count = 0;
  reset_image_transfer_state();
  s_selected_image_focus_id[0] = '\0';
}

static void schedule_image_retry(void) {
  if (!s_image_retry_timer && s_view_state == ViewStateChat && s_messages_root) {
    s_image_retry_timer = app_timer_register(IMAGE_COMMAND_RETRY_MS, image_retry_timer_callback, NULL);
  }
}

static void schedule_image_timeout(uint32_t timeout_ms) {
  if (s_image_retry_timer) {
    app_timer_cancel(s_image_retry_timer);
  }
  if (s_view_state == ViewStateChat && s_messages_root) {
    s_image_retry_timer = app_timer_register(timeout_ms, image_retry_timer_callback, NULL);
  } else {
    s_image_retry_timer = NULL;
  }
}

static void schedule_image_prepare_timeout(void) {
  schedule_image_timeout(IMAGE_PREPARE_STALL_MS);
}

static void schedule_image_transfer_timeout(void) {
  schedule_image_timeout(IMAGE_TRANSFER_STALL_MS);
}

static bool message_needs_image(Message *message) {
  return message && message->image_placeholder && message->image_token[0] &&
         !message->image_requested && !message->image_failed && !message->image_bitmap;
}

static int message_image_display_width(const Message *message, int max_w) {
  if (!message || message->image_width <= 0 || message->image_height <= 0) {
    return max_w;
  }
  int max_h = message->image_height > message->image_width ?
              IMAGE_THUMB_SIZE * IMAGE_TALL_MAX_MULTIPLIER : IMAGE_THUMB_SIZE;
  int w = max_w;
  int h = (message->image_height * w) / message->image_width;
  if (h > max_h) {
    h = max_h;
    w = (message->image_width * h) / message->image_height;
  }
  return PG_MAX(32, PG_MIN(PG_MIN(max_w, (int)message->image_width), w));
}

static int message_image_display_height(const Message *message, int max_w) {
  if (!message || message->image_width <= 0 || message->image_height <= 0) {
    return IMAGE_THUMB_SIZE;
  }
  int max_h = message->image_height > message->image_width ?
              IMAGE_THUMB_SIZE * IMAGE_TALL_MAX_MULTIPLIER : IMAGE_THUMB_SIZE;
  int w = max_w;
  int h = (message->image_height * w) / message->image_width;
  if (h > max_h) {
    h = max_h;
  }
  return PG_MAX(32, PG_MIN(PG_MIN(max_h, (int)message->image_height), h));
}

static int message_index_from_ptr(Message *message) {
  if (!message || message < s_messages || message >= s_messages + MAX_MESSAGES) {
    return -1;
  }
  return (int)(message - s_messages);
}

static void set_message_image_error(Message *message, const char *error) {
  if (!message) {
    return;
  }
  copy_cstr(message->image_error, sizeof(message->image_error), error && error[0] ? error : "Photo failed");
  message->image_progress = 0;
}

static void set_message_image_progress(Message *message, int percent) {
  if (!message) {
    return;
  }
  percent = PG_MAX(0, PG_MIN(100, percent));
  if (percent > message->image_progress) {
    message->image_progress = (uint8_t)percent;
  }
}

static bool message_image_near_viewport(int index, int margin) {
  if (index < 0 || index >= s_message_count || !s_messages[index].image_placeholder) {
    return false;
  }
  if (!s_messages_root) {
    return false;
  }
  GRect bounds = layer_get_bounds(s_messages_root);
  int bubble_w = message_bubble_width(bounds);
  int image_h = message_image_display_height(&s_messages[index], message_image_frame_width(bubble_w));
  int image_top = s_message_y[index] + s_message_h[index] - image_h - 4;
  int image_bottom = image_top + image_h;
  return image_bottom >= s_chat_scroll_offset - margin &&
         image_top <= s_chat_scroll_offset + bounds.size.h + margin;
}

static bool message_image_visible(int index) {
  return message_image_near_viewport(index, 0);
}

static int visible_message_height(GRect bounds) {
#if TOUCH_KEYBOARD_AVAILABLE
  return s_touch_keyboard_open ? touch_keyboard_viewport_height(bounds) : bounds.size.h;
#else
  return bounds.size.h;
#endif
}

static int message_image_top(int index, GRect bounds) {
  if (index < 0 || index >= s_message_count || !s_messages[index].image_placeholder) {
    return s_message_y[index];
  }
  int bubble_w = message_bubble_width(bounds);
  int max_image_w = message_image_frame_width(bubble_w);
  int image_h = message_image_display_height(&s_messages[index], max_image_w);
  int reaction_h = message_reaction_height(&s_messages[index], bubble_w - 10);
  return s_message_y[index] + s_message_h[index] - reaction_h - image_h - 4;
}

static bool message_image_scrolls_tall(int index, GRect bounds, int margin) {
  if (index < 0 || index >= s_message_count || !s_messages[index].image_placeholder) {
    return false;
  }
  int bubble_w = message_bubble_width(bounds);
  int image_h = message_image_display_height(&s_messages[index], message_image_frame_width(bubble_w));
  return image_h > visible_message_height(bounds) - (margin * 2);
}

static int message_image_edge_scroll_target(int index, GRect bounds, int margin, bool align_top) {
  int bubble_w = message_bubble_width(bounds);
  int image_h = message_image_display_height(&s_messages[index], message_image_frame_width(bubble_w));
  int image_top = message_image_top(index, bounds);
  int image_bottom = image_top + image_h;
  return align_top ? image_top - margin : image_bottom + margin - visible_message_height(bounds);
}

static bool message_image_should_keep(int index) {
  if (index < 0 || index >= s_message_count) {
    return false;
  }
  if (index == s_selected_message) {
    return true;
  }
  return message_image_near_viewport(index, IMAGE_KEEP_SCREEN_MARGIN);
}

static int message_image_focus_distance(int index) {
  if (s_selected_message >= 0 && s_selected_message < s_message_count) {
    return abs(index - s_selected_message) * 1000;
  }
  if (!s_messages_root) {
    return index * 1000;
  }
  GRect bounds = layer_get_bounds(s_messages_root);
  int focus_y = s_chat_scroll_offset + (bounds.size.h / 2);
  int bubble_w = message_bubble_width(bounds);
  int image_h = message_image_display_height(&s_messages[index], message_image_frame_width(bubble_w));
  int image_y = s_message_y[index] + s_message_h[index] - (image_h / 2) - 4;
  return abs(image_y - focus_y);
}

static bool message_needs_decode_headroom(const Message *message, int image_size) {
  if (!message) {
    return image_size >= IMAGE_DECODE_HEADROOM_BYTES;
  }
  if (image_size >= IMAGE_DECODE_HEADROOM_BYTES) {
    return true;
  }
  if (!s_messages_root) {
    return false;
  }
  GRect bounds = layer_get_bounds(s_messages_root);
  int bubble_w = message_bubble_width(bounds);
  int image_w = message_image_display_width(message, message_image_frame_width(bubble_w));
  int image_h = message_image_display_height(message, message_image_frame_width(bubble_w));
  return image_w * image_h >= IMAGE_DECODE_HEADROOM_PIXELS;
}

static size_t message_image_bitmap_heap_estimate(const Message *message) {
  if (!message || message->image_width == 0 || message->image_height == 0) {
    return 0;
  }
  size_t row_bytes = (size_t)((message->image_width + 3) & ~3);
  return row_bytes * message->image_height;
}

static bool message_image_decode_has_headroom(const Message *message) {
#ifdef _PBL_API_EXISTS_heap_bytes_free
  size_t estimate = message_image_bitmap_heap_estimate(message);
  if (estimate > 0) {
    size_t needed = estimate + IMAGE_DECODE_FINAL_HEADROOM_BYTES;
    size_t available = heap_bytes_free();
    if (available < needed) {
      APP_LOG(APP_LOG_LEVEL_WARNING, "Photo decode skipped, heap %u need %u",
              (unsigned)available, (unsigned)needed);
      return false;
    }
  }
#endif
  return true;
}

static unsigned image_request_decode_cost_budget(void) {
#ifdef _PBL_API_EXISTS_heap_bytes_free
  size_t available = heap_bytes_free();
  size_t reserve = IMAGE_DECODE_FINAL_HEADROOM_BYTES + 4096;
  if (available <= reserve) {
    return 0;
  }
  size_t budget = available - reserve;
  return (unsigned)PG_MIN(budget, 65000);
#else
  return 0;
#endif
}

#if IMAGE_DIAG_LOGS
static unsigned image_diag_heap_free(void) {
#ifdef _PBL_API_EXISTS_heap_bytes_free
  return (unsigned)heap_bytes_free();
#else
  return 0;
#endif
}
#endif

static bool message_is_gif(const Message *message) {
  return message && strncmp(message->text, "[GIF", 4) == 0;
}

static bool destroy_farthest_loaded_image(void) {
  int farthest_index = -1;
  int farthest_distance = -1;
  for (int i = 0; i < s_message_count; i++) {
    if (!s_messages[i].image_bitmap || message_image_visible(i)) {
      continue;
    }
    int distance = message_image_focus_distance(i);
    if (distance > farthest_distance) {
      farthest_distance = distance;
      farthest_index = i;
    }
  }
  if (farthest_index < 0) {
    return false;
  }
  destroy_message_bitmap(&s_messages[farthest_index]);
  return true;
}

static void prepare_selected_image_request(void) {
  if (s_selected_message < 0 || s_selected_message >= s_message_count ||
      !s_messages[s_selected_message].image_placeholder ||
      !s_messages[s_selected_message].image_token[0]) {
    s_selected_image_focus_id[0] = '\0';
    return;
  }
  Message *selected = &s_messages[s_selected_message];
  if (strcmp(s_selected_image_focus_id, selected->image_token) != 0) {
    copy_cstr(s_selected_image_focus_id, sizeof(s_selected_image_focus_id), selected->image_token);
    selected->image_failed = false;
    selected->image_error[0] = '\0';
    selected->image_progress = 0;
    selected->image_retry_level = 0;
  }

  if (s_image_message_id[0] && strcmp(s_image_message_id, selected->image_token) != 0) {
    clear_active_image_request();
  }
}

static void clear_active_image_request(void) {
  Message *message = find_message_by_image_token(s_image_message_id);
  if (s_image_retry_timer) {
    app_timer_cancel(s_image_retry_timer);
    s_image_retry_timer = NULL;
  }
  if (message) {
    message->image_requested = false;
  }
  reset_image_transfer_state();
}

static bool click_is_repeating(ClickRecognizerRef recognizer) {
  return recognizer && click_number_of_clicks_counted(recognizer) > 1;
}

static void sync_message_images(void) {
  for (int i = 0; i < MAX_MESSAGES; i++) {
    if (!message_image_should_keep(i)) {
      destroy_message_bitmap(&s_messages[i]);
      s_messages[i].image_failed = false;
      s_messages[i].image_error[0] = '\0';
      s_messages[i].image_progress = 0;
    }
  }

  if (s_image_message_id[0]) {
    Message *message = find_message_by_image_token(s_image_message_id);
    int image_index = message_index_from_ptr(message);
    if (!message_image_should_keep(image_index)) {
      clear_active_image_request();
    }
  }

  refresh_loaded_image_count();
  while (s_loaded_image_count > MAX_LOADED_IMAGES && destroy_farthest_loaded_image()) {
    refresh_loaded_image_count();
  }
  while (s_loaded_image_count > MAX_LOADED_IMAGES && destroy_unselected_loaded_image()) {
    refresh_loaded_image_count();
  }
}

static void destroy_offscreen_message_images(void) {
  sync_message_images();
}

static bool message_is_at_or_below_selection(int index) {
  return s_selected_message < 0 || s_selected_message >= s_message_count || index >= s_selected_message;
}

static bool selected_message_needs_image(void) {
  return s_selected_message >= 0 && s_selected_message < s_message_count &&
         s_messages[s_selected_message].image_placeholder &&
         s_messages[s_selected_message].image_token[0] &&
         !s_messages[s_selected_message].image_failed &&
         !s_messages[s_selected_message].image_bitmap;
}

static bool destroy_unselected_loaded_image(void) {
  int farthest_index = -1;
  int farthest_distance = -1;
  for (int i = 0; i < s_message_count; i++) {
    if (i == s_selected_message || !s_messages[i].image_bitmap) {
      continue;
    }
    int distance = message_image_focus_distance(i);
    if (distance > farthest_distance) {
      farthest_distance = distance;
      farthest_index = i;
    }
  }
  if (farthest_index < 0) {
    return false;
  }
  destroy_message_bitmap(&s_messages[farthest_index]);
  return true;
}

static int find_best_image_candidate(bool visible_only, bool prefer_below_selection) {
  int best_index = -1;
  int best_distance = 2147483647;
  for (int i = 0; i < s_message_count; i++) {
    if (!message_needs_image(&s_messages[i])) {
      continue;
    }
    if (visible_only) {
      if (!message_image_visible(i)) {
        continue;
      }
    } else if (!message_image_near_viewport(i, IMAGE_LOAD_SCREEN_MARGIN)) {
      continue;
    }
    if (prefer_below_selection && !message_is_at_or_below_selection(i)) {
      continue;
    }
    int distance = message_image_focus_distance(i);
    if (distance < best_distance) {
      best_distance = distance;
      best_index = i;
    }
  }
  return best_index;
}

static bool send_command_with_status(const char *command, const char *chat_id, const char *text,
                                     const char *reply_to, const char *message_id, bool show_failures) {
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK || !iter) {
    if (show_failures) {
      show_status("Bridge busy");
    }
    return false;
  }

  DictionaryResult dict_result = dict_write_cstring(iter, MESSAGE_KEY_Command, command);
  if (dict_result != DICT_OK) {
    if (show_failures) {
      show_status("Command write fail");
    }
    return false;
  }
  if (chat_id) {
    dict_result = dict_write_cstring(iter, MESSAGE_KEY_ChatId, chat_id);
    if (dict_result != DICT_OK) {
      if (show_failures) {
        show_status("Chat ID write fail");
      }
      return false;
    }
  }
  if (text) {
    dict_result = dict_write_cstring(iter, MESSAGE_KEY_Text, text);
    if (dict_result != DICT_OK) {
      if (show_failures) {
        show_status("Text write fail");
      }
      return false;
    }
  }
  if (reply_to) {
    dict_result = dict_write_cstring(iter, MESSAGE_KEY_ReplyTo, reply_to);
    if (dict_result != DICT_OK) {
      if (show_failures) {
        show_status("Reply write fail");
      }
      return false;
    }
  }
  if (text && message_id && strcmp(command, "edit_message") == 0) {
    dict_result = dict_write_cstring(iter, MESSAGE_KEY_EditMessageId, message_id);
    if (dict_result != DICT_OK) {
      if (show_failures) {
        show_status("Edit ID write fail");
      }
      return false;
    }
  }
  if (message_id) {
    dict_result = dict_write_cstring(iter, MESSAGE_KEY_MessageId, message_id);
    if (dict_result != DICT_OK) {
      if (show_failures) {
        show_status("Msg ID write fail");
      }
      return false;
    }
  }
  dict_write_end(iter);
  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    if (show_failures) {
      show_status("Command send fail");
    }
    return false;
  }
  return true;
}

static bool send_command(const char *command, const char *chat_id, const char *text,
                         const char *reply_to, const char *message_id) {
  return send_command_with_status(command, chat_id, text, reply_to, message_id, true);
}

static const char *default_status_text(void) {
  if (s_view_state == ViewStateChat && s_current_chat_title[0]) {
    return s_current_chat_title;
  }
  return "Pebblegram";
}

static bool status_message_should_persist(const char *message) {
  if (!message || !message[0] || strcmp(message, default_status_text()) == 0) {
    return true;
  }
  return strncmp(message, "Loading", 7) == 0 ||
         strncmp(message, "Connecting", 10) == 0 ||
         strncmp(message, "Fetching", 8) == 0 ||
         strncmp(message, "Requesting", 10) == 0;
}

static void cancel_status_clear(void) {
  if (s_status_clear_timer) {
    app_timer_cancel(s_status_clear_timer);
    s_status_clear_timer = NULL;
  }
}

static void schedule_status_clear(const char *message) {
  cancel_status_clear();
  if (!s_chats_loading && !status_message_should_persist(message)) {
    s_status_clear_timer = app_timer_register(STATUS_CLEAR_MS, status_clear_timer_callback, NULL);
  }
}

static void status_clear_timer_callback(void *data) {
  s_status_clear_timer = NULL;
  if (!s_chats_loading) {
    show_status(default_status_text());
  }
}

static void show_status(const char *message) {
  if (s_status_layer) {
    const char *shown = s_chats_loading ? "Pebblegram" :
                        (message && message[0] ? message : default_status_text());
    copy_cstr(s_status_text, sizeof(s_status_text), shown);
    text_layer_set_text(s_status_layer, s_status_text);
    text_layer_set_text_color(s_status_layer, GColorWhite);
    text_layer_set_background_color(s_status_layer, APP_COLOR);
    schedule_status_clear(shown);
  }
}

static void show_loading_text(const char *message, bool is_error) {
  copy_cstr(s_loading_text, sizeof(s_loading_text), message && message[0] ? message : "Loading...");
  s_loading_error = is_error;
  if (s_chat_menu) {
    menu_layer_reload_data(s_chat_menu);
  }
}

static int progress_percent(int current, int total) {
  if (total <= 0) {
    return current > 0 ? 100 : 0;
  }
  return PG_MAX(0, PG_MIN(100, (current * 100) / total));
}

static int image_loading_phase_percent(const char *detail) {
  if (!detail || !detail[0]) {
    return 5;
  }
  if (strcmp(detail, "Waiting phone") == 0) {
    return 5;
  }
  if (strcmp(detail, "Preparing") == 0) {
    return 10;
  }
  if (strcmp(detail, "Downloading") == 0) {
    return 15;
  }
  if (strcmp(detail, "Decoding") == 0) {
    return 20;
  }
  if (strcmp(detail, "Sending") == 0) {
    return 25;
  }
  if (strcmp(detail, "Receiving") == 0) {
    return 25;
  }
  return 10;
}

static int chat_loading_percent(void) {
  int percent;
  if (s_expected_rows > 0) {
    percent = 90 + ((PG_MAX(0, PG_MIN(s_chat_count, s_expected_rows)) * 10) / s_expected_rows);
  } else if (strcmp(s_loading_text, "Connecting...") == 0) {
    percent = 15;
  } else if (strcmp(s_loading_text, "Fetching chats...") == 0) {
    percent = 45;
  } else if (strcmp(s_loading_text, "Sending chats...") == 0) {
    percent = 90;
  } else {
    percent = 8;
  }
  if (percent > s_chat_loading_progress) {
    s_chat_loading_progress = percent;
  }
  return s_chat_loading_progress;
}

static void draw_loading_bar(GContext *ctx, GRect rect, int percent) {
  percent = PG_MAX(0, PG_MIN(100, percent));
  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_draw_round_rect(ctx, rect, 2);
  if (percent > 0) {
    int pad = 3;
    int fill_w = ((rect.size.w - (pad * 2)) * percent) / 100;
    GRect fill = GRect(rect.origin.x + pad, rect.origin.y + pad,
                      PG_MAX(1, fill_w), rect.size.h - (pad * 2));
    graphics_context_set_fill_color(ctx, APP_COLOR);
    graphics_fill_rect(ctx, fill, 1, GCornersAll);
  }
}

static uint16_t chat_menu_get_num_sections_callback(MenuLayer *menu_layer, void *data) {
  return 1;
}

static uint16_t chat_menu_get_num_rows_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
  return s_chat_count > 0 ? s_chat_count : 1;
}

static int16_t chat_menu_get_header_height_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
  return 0;
}

static void chat_menu_draw_row_callback(GContext *ctx, const Layer *cell_layer, MenuIndex *cell_index, void *data) {
  GRect bounds = layer_get_bounds(cell_layer);
  GRect safe = round_safe_rect(bounds);
  bool selected = menu_layer_is_index_selected(s_chat_menu, cell_index);

  graphics_context_set_fill_color(ctx, CHAT_BG);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  if (s_chat_count == 0) {
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, s_loading_error ? "Login needs attention" :
                       (s_bridge_ready ? "No chats yet" : "Loading..."),
                       fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                       GRect(safe.origin.x, s_chats_loading ? (bounds.size.h / 2) - 34 : (bounds.size.h - 40) / 2,
                             safe.size.w, 40),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
    if (s_loading_error) {
      graphics_context_set_text_color(ctx, GColorDarkGray);
      graphics_draw_text(ctx, s_loading_text, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                         GRect(safe.origin.x + 4, (bounds.size.h / 2), safe.size.w - 8, 44),
                         GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
    } else if (s_chats_loading) {
      int bar_w = PG_MIN(safe.size.w - 24, 112);
      GRect bar = GRect(safe.origin.x + ((safe.size.w - bar_w) / 2), (bounds.size.h / 2) + 2,
                        bar_w, 14);
      draw_loading_bar(ctx, bar, chat_loading_percent());
      graphics_context_set_text_color(ctx, GColorDarkGray);
      graphics_draw_text(ctx, s_loading_text, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                         GRect(safe.origin.x, bar.origin.y + 15, safe.size.w, 22),
                         GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
    }
    return;
  }

  if (selected) {
    graphics_context_set_fill_color(ctx, APP_COLOR_LIGHT);
    graphics_fill_rect(ctx, GRect(safe.origin.x - 4, 1, safe.size.w + 8, bounds.size.h - 3),
                       ROUND_UI ? 5 : 0, GCornersAll);
  }
  graphics_context_set_stroke_color(ctx, GColorLightGray);
  graphics_draw_line(ctx, GPoint(safe.origin.x, bounds.size.h - 1),
                     GPoint(safe.origin.x + safe.size.w, bounds.size.h - 1));

  graphics_context_set_text_color(ctx, selected ? GColorWhite : GColorBlack);

  Chat *chat = &s_chats[cell_index->row];
  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  int unread_w = chat->unread ? 24 : 0;
  int avatar_r = ROUND_UI ? 12 : 14;
  int avatar_cx = safe.origin.x + avatar_r + 1;
  int avatar_cy = bounds.size.h / 2;
  int text_x = safe.origin.x + (avatar_r * 2) + 8;
  int text_w = safe.size.w - (text_x - safe.origin.x) - unread_w;
  GColor row_bg = selected ? APP_COLOR_LIGHT : CHAT_BG;
  char initials[3];

  graphics_context_set_fill_color(ctx, GColorLightGray);
  graphics_fill_circle(ctx, GPoint(avatar_cx, avatar_cy), avatar_r);
  if (chat->avatar_bitmap) {
    graphics_draw_bitmap_in_rect(ctx, chat->avatar_bitmap,
                                 GRect(avatar_cx - avatar_r, avatar_cy - avatar_r,
                                       avatar_r * 2, avatar_r * 2));
    mask_avatar_corners(ctx, GPoint(avatar_cx, avatar_cy), avatar_r, row_bg);
  }
  graphics_context_set_stroke_color(ctx, selected ? GColorWhite : APP_COLOR);
  graphics_draw_circle(ctx, GPoint(avatar_cx, avatar_cy), avatar_r);
  if (!chat->avatar_bitmap) {
    chat_initials(chat->title, initials, sizeof(initials));
    graphics_context_set_text_color(ctx, APP_COLOR);
    graphics_draw_text(ctx, initials, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(avatar_cx - avatar_r, avatar_cy - 9, avatar_r * 2, 18),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }

  graphics_context_set_text_color(ctx, selected ? GColorWhite : GColorBlack);
  graphics_draw_text(ctx, chat->title, title_font, GRect(text_x, -4, text_w, 25),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, selected ? GColorWhite : GColorDarkGray);
  graphics_draw_text(ctx, chat->preview, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(text_x, 20, text_w, 23), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  if (chat->unread) {
    int cx = safe.origin.x + safe.size.w - 12;
    int cy = bounds.size.h / 2;
    graphics_context_set_fill_color(ctx, UNREAD_COLOR);
    if (chat->unread_count > 0) {
      graphics_fill_circle(ctx, GPoint(cx, cy), 10);
      char unread_text[12];
      if (chat->unread_count > 99) {
        copy_cstr(unread_text, sizeof(unread_text), "99+");
      } else {
        snprintf(unread_text, sizeof(unread_text), "%d", chat->unread_count);
      }
      graphics_context_set_text_color(ctx, GColorBlack);
      graphics_draw_text(ctx, unread_text, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                         GRect(cx - 10, cy - 10, 20, 18),
                         GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
    } else {
      graphics_fill_circle(ctx, GPoint(cx, cy), 4);
    }
  }
}

static int16_t chat_menu_get_cell_height_callback(struct MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
  if (s_chat_count == 0) {
    Layer *layer = menu_layer_get_layer(menu_layer);
    return layer_get_bounds(layer).size.h;
  }
  return ROUND_UI ? 42 : 46;
}

static void chat_menu_select_callback(struct MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
  if (s_loading_messages) {
    show_status("Loading messages...");
    return;
  }
  if (s_chat_count == 0) {
    request_chats();
    return;
  }
  s_selected_chat = cell_index->row;
  copy_cstr(s_current_chat_id, sizeof(s_current_chat_id), s_chats[s_selected_chat].id);
  copy_cstr(s_current_chat_title, sizeof(s_current_chat_title), s_chats[s_selected_chat].title);
  request_messages(s_current_chat_id);
}

static int clamp_scroll_offset(int offset) {
  if (!s_messages_root) {
    return 0;
  }
  GRect bounds = layer_get_bounds(s_messages_root);
  int visible_h = bounds.size.h;
#if TOUCH_KEYBOARD_AVAILABLE
  if (s_touch_keyboard_open) {
    visible_h = touch_keyboard_viewport_height(bounds);
  }
#endif
  int max_offset = PG_MAX(0, s_chat_content_height - visible_h);
  return PG_MAX(0, PG_MIN(offset, max_offset));
}


static bool message_has_context(Message *message) {
  return message && message->context[0];
}

static void copy_context_part(char *dest, size_t dest_size, const char *start, const char *end) {
  size_t len;
  if (!dest || dest_size == 0) {
    return;
  }
  if (!start) {
    dest[0] = '\0';
    return;
  }
  len = end && end > start ? (size_t)(end - start) : strlen(start);
  if (len >= dest_size) {
    len = dest_size - 1;
  }
  memcpy(dest, start, len);
  dest[len] = '\0';
  trim_incomplete_utf8(dest);
}

static int message_context_height(Message *message) {
  return message_has_context(message) ? 36 : 0;
}

static void message_context_strings(Message *message, char *title, size_t title_size,
                                    char *body, size_t body_size) {
  char *separator = strchr(message->context, '\n');
  copy_context_part(title, title_size, message->context, separator);
  copy_context_part(body, body_size, separator ? separator + 1 : "Message", NULL);
}

static void build_message_context(char *context, size_t context_size,
                                  const char *reply_sender, const char *reply_text,
                                  const char *forward_sender, const char *forward_text) {
  const char *sender;
  const char *text;
  if (!context || context_size == 0) {
    return;
  }
  context[0] = '\0';
  if ((reply_sender && reply_sender[0]) || (reply_text && reply_text[0])) {
    sender = reply_sender && reply_sender[0] ? reply_sender : "Reply";
    text = reply_text && reply_text[0] ? reply_text : "Message";
    snprintf(context, context_size, "%s\n%s", sender, text);
    trim_incomplete_utf8(context);
    return;
  }
  if ((forward_sender && forward_sender[0]) || (forward_text && forward_text[0])) {
    sender = forward_sender && forward_sender[0] ? forward_sender : "Forwarded";
    text = forward_text && forward_text[0] ? forward_text : "Message";
    snprintf(context, context_size, "Fwd from %s\n%s", sender, text);
    trim_incomplete_utf8(context);
    return;
  }
}


static void clear_message_slot(Message *message) {
  if (!message) {
    return;
  }
  if (s_image_message_id[0] && strcmp(s_image_message_id, message->image_token) == 0) {
    clear_active_image_request();
  }
  destroy_message_bitmap(message);
  release_message_strings(message);
  memset(message, 0, sizeof(Message));
  init_message_strings(message);
}

static void clear_message_rows(void) {
  for (int i = 0; i < MAX_MESSAGES; i++) {
    clear_message_slot(&s_messages[i]);
  }
  s_message_count = 0;
  s_selected_message = -1;
  s_expected_rows = 0;
  s_chat_scroll_offset = 0;
  s_chat_content_height = 0;
}

static void reset_message_stream_state(void) {
  s_message_stream_silent = false;
  s_message_stream_mode = MESSAGE_MODE_INITIAL;
}

static void clear_message_stage(void) {
  if (!s_message_stage) {
    s_message_stage_count = 0;
    return;
  }
  for (int i = 0; i < MAX_MESSAGES; i++) {
    clear_message_slot(&s_message_stage[i]);
  }
  free(s_message_stage);
  s_message_stage = NULL;
  s_message_stage_count = 0;
}

static bool prepare_message_stage(void) {
  clear_message_stage();
  s_message_stage = malloc(sizeof(Message) * MAX_MESSAGES);
  if (!s_message_stage) {
    destroy_message_images();
    s_message_stage = malloc(sizeof(Message) * MAX_MESSAGES);
  }
  if (!s_message_stage) {
    return false;
  }
  memset(s_message_stage, 0, sizeof(Message) * MAX_MESSAGES);
  for (int i = 0; i < MAX_MESSAGES; i++) {
    init_message_strings(&s_message_stage[i]);
  }
  s_message_stage_count = 0;
  return true;
}

static bool messages_match_image(const Message *a, const Message *b) {
  return a && b && a->id[0] && b->id[0] && a->image_token[0] &&
         strcmp(a->id, b->id) == 0 && strcmp(a->image_token, b->image_token) == 0;
}

static void preserve_stage_image_state(void) {
  if (!s_message_stage) {
    return;
  }
  int rows = PG_MIN(s_message_stage_count, MAX_MESSAGES);
  for (int i = 0; i < rows; i++) {
    Message *stage = &s_message_stage[i];
    for (int j = 0; j < s_message_count; j++) {
      Message *current = &s_messages[j];
      if (!messages_match_image(stage, current)) {
        continue;
      }
      if (!stage->image_bitmap && current->image_bitmap) {
        stage->image_bitmap = current->image_bitmap;
        stage->image_data = current->image_data;
        current->image_bitmap = NULL;
        current->image_data = NULL;
      }
      stage->image_requested = current->image_requested;
      stage->image_failed = current->image_failed;
      stage->image_retry_level = current->image_retry_level;
      copy_cstr(stage->image_error, sizeof(stage->image_error), current->image_error);
      current->image_token[0] = '\0';
      break;
    }
  }
}

static void commit_message_stage(int count) {
  if (!s_message_stage) {
    return;
  }
  preserve_stage_image_state();
  clear_message_rows();
  int rows = PG_MIN(PG_MIN(count, s_message_stage_count), MAX_MESSAGES);
  for (int i = 0; i < rows; i++) {
    s_messages[i] = s_message_stage[i];
    memset(&s_message_stage[i], 0, sizeof(Message));
  }
  for (int i = rows; i < MAX_MESSAGES; i++) {
    clear_message_slot(&s_message_stage[i]);
  }
  s_message_count = rows;
  free(s_message_stage);
  s_message_stage = NULL;
  s_message_stage_count = 0;
  refresh_loaded_image_count();
}

static bool message_transfer_matches(DictionaryIterator *iter) {
  int transfer_id = tuple_int(iter, MESSAGE_KEY_ImageTransferId, 0);
  return transfer_id == 0 || (s_message_transfer_id != 0 && transfer_id == s_message_transfer_id);
}

static void populate_message_from_tuple(Message *message, DictionaryIterator *iter) {
  char context[MAX_CONTEXT_TEXT];
  char *incoming_message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
  char *incoming_image_token = tuple_cstring(iter, MESSAGE_KEY_ImageToken);
  bool preserve_image_state = incoming_message_id && incoming_image_token &&
                              strcmp(message->id, incoming_message_id) == 0 &&
                              strcmp(message->image_token, incoming_image_token) == 0;
  if (!preserve_image_state) {
    destroy_message_bitmap(message);
  }
  copy_cstr(message->id, sizeof(message->id), incoming_message_id);
  build_message_context(context, sizeof(context),
                        tuple_cstring(iter, MESSAGE_KEY_ReplySender),
                        tuple_cstring(iter, MESSAGE_KEY_ReplyText),
                        tuple_cstring(iter, MESSAGE_KEY_ForwardSender),
                        tuple_cstring(iter, MESSAGE_KEY_ForwardText));
  set_message_strings(message,
                      tuple_cstring(iter, MESSAGE_KEY_Sender),
                      tuple_cstring(iter, MESSAGE_KEY_Text),
                      tuple_cstring(iter, MESSAGE_KEY_Reactions),
                      tuple_cstring(iter, MESSAGE_KEY_MessageMeta),
                      context);
  message->outgoing = tuple_int(iter, MESSAGE_KEY_IsOutgoing, 0) != 0;
  copy_cstr(message->image_token, sizeof(message->image_token), incoming_image_token);
  message->image_placeholder = message->image_token[0] != '\0';
  message->image_width = tuple_int(iter, MESSAGE_KEY_ImageWidth, message->image_placeholder ? IMAGE_THUMB_SIZE : 0);
  message->image_height = tuple_int(iter, MESSAGE_KEY_ImageHeight, message->image_placeholder ? IMAGE_THUMB_SIZE : 0);
  if (!preserve_image_state) {
    message->image_requested = false;
    message->image_failed = false;
    message->image_error[0] = '\0';
    message->image_progress = 0;
    message->image_retry_level = 0;
    message->image_bitmap = NULL;
  }
}

static Message *prepend_message_slot(void) {
  if (s_message_count >= MAX_MESSAGES) {
    clear_message_slot(&s_messages[MAX_MESSAGES - 1]);
    s_message_count = MAX_MESSAGES - 1;
  }
  for (int i = s_message_count; i > 0; i--) {
    s_messages[i] = s_messages[i - 1];
  }
  memset(&s_messages[0], 0, sizeof(Message));
  init_message_strings(&s_messages[0]);
  s_message_count++;
  return &s_messages[0];
}

static Message *append_message_slot(void) {
  if (s_message_count >= MAX_MESSAGES) {
    clear_message_slot(&s_messages[0]);
    for (int i = 0; i < MAX_MESSAGES - 1; i++) {
      s_messages[i] = s_messages[i + 1];
    }
    s_message_count = MAX_MESSAGES - 1;
    if (s_selected_message > 0) {
      s_selected_message--;
    }
  }
  memset(&s_messages[s_message_count], 0, sizeof(Message));
  init_message_strings(&s_messages[s_message_count]);
  s_message_count++;
  return &s_messages[s_message_count - 1];
}

static void remove_message_at(int index) {
  char anchor_id[MAX_ID];
  int anchor_y = 0;
  anchor_id[0] = '\0';
  if (index < 0 || index >= s_message_count) {
    return;
  }
  if (s_messages_root) {
    recalc_message_layout();
    int anchor_index = index + 1 < s_message_count ? index + 1 : index - 1;
    if (anchor_index >= 0 && anchor_index < s_message_count) {
      copy_cstr(anchor_id, sizeof(anchor_id), s_messages[anchor_index].id);
      anchor_y = s_message_y[anchor_index];
    }
  }
  clear_message_slot(&s_messages[index]);
  for (int i = index; i < s_message_count - 1; i++) {
    s_messages[i] = s_messages[i + 1];
  }
  memset(&s_messages[s_message_count - 1], 0, sizeof(Message));
  init_message_strings(&s_messages[s_message_count - 1]);
  s_message_count--;
  if (s_message_count <= 0) {
    s_selected_message = s_at_newest ? s_message_count : -1;
  } else if (index < s_message_count) {
    s_selected_message = index;
  } else {
    s_selected_message = s_message_count - 1;
  }
  if (s_messages_root) {
    if (anchor_id[0]) {
      preserve_stream_anchor(anchor_id, anchor_y, true);
    } else {
      recalc_message_layout();
      set_chat_scroll_offset(s_chat_scroll_offset, false);
      layer_mark_dirty(s_messages_root);
      request_next_image();
    }
  }
}

static void preserve_stream_anchor(const char *anchor_id, int anchor_y, bool dirty) {
  recalc_message_layout();
  if (anchor_id && anchor_id[0]) {
    int anchor_index = find_message_index_by_id(anchor_id);
    if (anchor_index >= 0) {
      s_selected_message = anchor_index;
      int target = s_chat_scroll_offset + (s_message_y[anchor_index] - anchor_y);
      if (dirty) {
        set_chat_scroll_offset(target, false);
      } else {
        set_chat_scroll_offset_quiet(target);
      }
    }
  }
  if (dirty && s_messages_root) {
    layer_mark_dirty(s_messages_root);
  }
  if (dirty) {
    request_next_image();
  }
}

static void render_after_stream_append(const char *anchor_id, int anchor_y) {
  if (s_message_stream_silent) {
    preserve_stream_anchor(anchor_id, anchor_y, false);
    return;
  }
  preserve_stream_anchor(anchor_id, anchor_y, true);
}

static void render_after_stream_prepend(const char *anchor_id, int anchor_y) {
  if (s_message_stream_silent) {
    preserve_stream_anchor(anchor_id, anchor_y, false);
    return;
  }
  if (!s_user_scrolled_messages && (!anchor_id || !anchor_id[0])) {
    recalc_message_layout();
    scroll_to_bottom(false);
    return;
  }
  preserve_stream_anchor(anchor_id, anchor_y, true);
}


static uint8_t message_meta_receipts(const char *meta) {
  char *separator = meta ? strchr(meta, '|') : NULL;
  if (!separator || !separator[1]) {
    return 0;
  }
  return separator[1] == '2' ? 2 : 1;
}

static void message_meta_time(const char *meta, char *dest, size_t dest_size) {
  char *separator = meta ? strchr(meta, '|') : NULL;
  if (!dest || dest_size == 0) {
    return;
  }
  if (!meta) {
    dest[0] = '\0';
    return;
  }
  if (separator) {
    copy_context_part(dest, dest_size, meta, separator);
  } else {
    copy_cstr(dest, dest_size, meta);
  }
}

static void draw_receipt_tick(GContext *ctx, int x, int y) {
  graphics_draw_line(ctx, GPoint(x, y + 4), GPoint(x + 2, y + 6));
  graphics_draw_line(ctx, GPoint(x + 2, y + 6), GPoint(x + 6, y + 1));
}

static void draw_message_meta(GContext *ctx, const char *meta, GFont font, GRect rect) {
  char time_text[8];
  uint8_t receipts = message_meta_receipts(meta);
  int ticks_w = receipts ? (receipts == 2 ? 13 : 7) : 0;
  message_meta_time(meta, time_text, sizeof(time_text));
  graphics_context_set_text_color(ctx, BW_UI ? GColorBlack : GColorDarkGray);
  graphics_context_set_stroke_color(ctx, BW_UI ? GColorBlack : GColorDarkGray);
  if (time_text[0] && rect.size.w > ticks_w + 2) {
    graphics_draw_text(ctx, time_text, font,
                       GRect(rect.origin.x, rect.origin.y, rect.size.w - ticks_w - 2, rect.size.h),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);
  }
  if (receipts) {
    int tick_x = rect.origin.x + rect.size.w - ticks_w;
    int tick_y = rect.origin.y + 5;
    draw_receipt_tick(ctx, tick_x, tick_y);
    if (receipts > 1) {
      draw_receipt_tick(ctx, tick_x + 6, tick_y);
    }
  }
}

static void draw_message_context(GContext *ctx, Message *message, GRect rect) {
  char title[MAX_SENDER + 10];
  char body[MAX_CONTEXT_TEXT];
  GColor fill = BW_UI ? GColorWhite : (message->outgoing ? OUT_CONTEXT_BUBBLE : IN_CONTEXT_BUBBLE);
  GColor accent = BW_UI ? GColorBlack : APP_COLOR;
  if (!message_has_context(message) || rect.size.h <= 0) {
    return;
  }
  message_context_strings(message, title, sizeof(title), body, sizeof(body));
  graphics_context_set_fill_color(ctx, fill);
  graphics_fill_rect(ctx, rect, 3, GCornersAll);
  graphics_context_set_fill_color(ctx, accent);
  graphics_fill_rect(ctx, GRect(rect.origin.x, rect.origin.y + 2, 3, rect.size.h - 4), 1, GCornersAll);
  graphics_context_set_text_color(ctx, accent);
  graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     GRect(rect.origin.x + 5, rect.origin.y, rect.size.w - 7, 15),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, body, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(rect.origin.x + 5, rect.origin.y + 14, rect.size.w - 7, rect.size.h - 14),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

static int message_reaction_height(Message *message, int text_w) {
  if (!message->reactions[0]) {
    return message->meta[0] ? REACTION_LINE_H : 0;
  }
  int meta_w = message->meta[0] ? PG_MIN(50, text_w) : 0;
  int width = text_w - meta_w - 6;
  if (width <= 8) {
    return REACTION_LINE_H;
  }
  // Reactions that fall back to :shortcode: text can need more than one line.
  GSize size = graphics_text_layout_get_content_size(
    message->reactions, fonts_get_system_font(FONT_KEY_GOTHIC_14),
    GRect(0, 0, width, REACTION_LINE_H * REACTION_MAX_LINES),
    GTextOverflowModeWordWrap, GTextAlignmentLeft);
  return PG_MAX(REACTION_LINE_H, PG_MIN(size.h + 3, REACTION_LINE_H * REACTION_MAX_LINES));
}

static int message_bubble_height(Message *message, int text_w, int bubble_w) {
  char display_text[MESSAGE_PREVIEW_TEXT + 8];
  GFont text_font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  int name_h = (!message->outgoing && message->sender[0]) ? 16 : 0;
  int reaction_h = message_reaction_height(message, text_w);
  int context_h = message_context_height(message);
  int image_h = message->image_placeholder ?
                message_image_display_height(message, message_image_frame_width(bubble_w)) + 8 : 0;
  copy_cstr(display_text, sizeof(display_text), message->text);
  truncate_cstr_bytes(display_text, sizeof(display_text), MESSAGE_PREVIEW_TEXT, " ...");
  GSize size = GSize(0, 0);
  if (display_text[0] && text_w > 4) {
    size = graphics_text_layout_get_content_size(
      display_text,
      text_font,
      GRect(0, 0, text_w, 2000),
      GTextOverflowModeWordWrap,
      GTextAlignmentLeft
    );
  }
  int text_h = display_text[0] ? size.h : 0;
  text_h = PG_MAX(0, PG_MIN(text_h, MAX_TEXT * 2));
  return PG_MAX(28, text_h + name_h + context_h + image_h + reaction_h + 7);
}

static void recalc_message_layout(void) {
  if (!s_messages_root) {
    return;
  }

  GRect bounds = layer_get_bounds(s_messages_root);
#if TOUCH_KEYBOARD_AVAILABLE
  int visible_h = s_touch_keyboard_open ? touch_keyboard_viewport_height(bounds) : bounds.size.h;
#else
  int visible_h = bounds.size.h;
#endif
  int bubble_w = message_bubble_width(bounds);
  int text_w = bubble_w - 10;
  int y = ROUND_UI ? 8 : 3;

  for (int i = 0; i < s_message_count; i++) {
    s_message_y[i] = y;
    s_message_h[i] = message_bubble_height(&s_messages[i], text_w, bubble_w);
    y += s_message_h[i] + (ROUND_UI ? 6 : 5);
  }
  int bottom_pad = ROUND_UI ? 12 : 5;
  int compose_min_y = visible_h - COMPOSE_BUBBLE_H - (ROUND_UI ? 8 : 6);
  bool reserve_compose_bubble = s_at_newest && !s_touch_keyboard_open;
  if (reserve_compose_bubble && s_message_count > 0 && y + COMPOSE_BUBBLE_GAP < compose_min_y) {
    int shift = compose_min_y - COMPOSE_BUBBLE_GAP - y;
    for (int i = 0; i < s_message_count; i++) {
      s_message_y[i] += shift;
    }
    y += shift;
  }
  if (reserve_compose_bubble) {
    s_compose_bubble_y = PG_MAX(y + COMPOSE_BUBBLE_GAP, compose_min_y);
    s_chat_content_height = s_compose_bubble_y + COMPOSE_BUBBLE_H + bottom_pad;
  } else {
    s_compose_bubble_y = y + COMPOSE_BUBBLE_GAP;
    s_chat_content_height = y + bottom_pad;
  }
  s_chat_scroll_offset = clamp_scroll_offset(s_chat_scroll_offset);
}

static void scroll_to_bottom(bool animated) {
  recalc_message_layout();
  s_selected_message = s_at_newest ? s_message_count : (s_message_count > 0 ? s_message_count - 1 : -1);
  set_chat_scroll_offset(s_chat_content_height, animated);
  destroy_offscreen_message_images();
  request_next_image();
}

static void go_to_bottom(void) {
  cancel_message_timeout();
  cancel_message_retry();
  s_loading_older_messages = false;
  s_loading_newer_messages = false;
  s_older_anchor_id[0] = '\0';
  s_newer_anchor_id[0] = '\0';
  s_older_anchor_y = 0;
  s_newer_anchor_y = 0;
  clear_message_stage();
  reset_message_stream_state();
  if (s_at_newest) {
    scroll_to_bottom(true);
  } else {
    s_user_scrolled_messages = false;
    s_message_scroll_direction = 1;
    request_newer_messages(false);
  }
}

static void chat_scroll_timer_callback(void *data) {
  s_chat_scroll_timer = NULL;
  s_chat_scroll_step++;

  if (s_chat_scroll_step >= CHAT_SCROLL_STEPS) {
    s_chat_scroll_offset = s_chat_scroll_target;
  } else {
    int delta = s_chat_scroll_target - s_chat_scroll_start;
    int progress = s_chat_scroll_step * CHAT_SCROLL_STEPS;
    int eased = (progress * 2) - (s_chat_scroll_step * s_chat_scroll_step);
    s_chat_scroll_offset = s_chat_scroll_start + ((delta * eased) / (CHAT_SCROLL_STEPS * CHAT_SCROLL_STEPS));
    s_chat_scroll_timer = app_timer_register(CHAT_SCROLL_FRAME_MS, chat_scroll_timer_callback, NULL);
  }

  if (s_messages_root) {
    layer_mark_dirty(s_messages_root);
  }
  request_next_image();
}

static void set_chat_scroll_offset_quiet(int target) {
  if (s_chat_scroll_timer) {
    app_timer_cancel(s_chat_scroll_timer);
    s_chat_scroll_timer = NULL;
  }
  s_chat_scroll_offset = clamp_scroll_offset(target);
}

static void finish_pending_chat_scroll(void) {
  if (!s_chat_scroll_timer) {
    return;
  }
  app_timer_cancel(s_chat_scroll_timer);
  s_chat_scroll_timer = NULL;
  s_chat_scroll_offset = clamp_scroll_offset(s_chat_scroll_target);
}

static void set_chat_scroll_offset(int target, bool animated) {
  target = clamp_scroll_offset(target);
  if (s_chat_scroll_timer) {
    app_timer_cancel(s_chat_scroll_timer);
    s_chat_scroll_timer = NULL;
  }

  if (!animated) {
    s_chat_scroll_offset = target;
    if (s_messages_root) {
      layer_mark_dirty(s_messages_root);
    }
    request_next_image();
    return;
  }

  s_chat_scroll_start = s_chat_scroll_offset;
  s_chat_scroll_target = target;
  if (s_chat_scroll_start == s_chat_scroll_target) {
    if (s_messages_root) {
      layer_mark_dirty(s_messages_root);
    }
    request_next_image();
    return;
  }
  s_chat_scroll_step = 0;
  s_chat_scroll_timer = app_timer_register(CHAT_SCROLL_FRAME_MS, chat_scroll_timer_callback, NULL);
}

static void select_message_with_alignment(int index, bool align_top, bool animated) {
  if (!s_messages_root || index < 0 || index >= s_message_count) {
    return;
  }

  s_selected_message = index;
  recalc_message_layout();
  prepare_selected_image_request();
  GRect bounds = layer_get_bounds(s_messages_root);
  int margin = 6;
  int top = s_message_y[s_selected_message] - margin;
  int bottom = s_message_y[s_selected_message] + s_message_h[s_selected_message] + margin;
  int target = s_chat_scroll_offset;

  if (message_image_scrolls_tall(s_selected_message, bounds, margin)) {
    target = message_image_edge_scroll_target(s_selected_message, bounds, margin, align_top);
    set_chat_scroll_offset(target, animated);
    request_next_image();
    return;
  }

  if (s_message_h[s_selected_message] > visible_message_height(bounds) - (margin * 2)) {
    target = align_top ? top : bottom - visible_message_height(bounds);
    set_chat_scroll_offset(target, animated);
    request_next_image();
    return;
  }

  if (align_top && top < s_chat_scroll_offset) {
    target = top;
    set_chat_scroll_offset(target, animated);
    request_next_image();
    return;
  }

  if (!align_top && bottom > s_chat_scroll_offset + visible_message_height(bounds)) {
    target = bottom - visible_message_height(bounds);
    set_chat_scroll_offset(target, animated);
    request_next_image();
    return;
  }

  if (s_messages_root) {
    layer_mark_dirty(s_messages_root);
  }
  request_next_image();
}

static void render_messages(void) {
  if (!s_messages_root) {
    return;
  }
  recalc_message_layout();
  if (!has_selected_message() && s_at_newest && s_message_count > 0) {
    s_selected_message = s_message_count;
    set_chat_scroll_offset(s_chat_content_height, false);
    return;
  }
  layer_mark_dirty(s_messages_root);
  request_next_image();
}

static GRect compose_rect_for_bounds(GRect bounds) {
  int compose_w = PG_MIN(bounds.size.w - 24, ROUND_UI ? 120 : 132);
  int compose_x = (bounds.size.w - compose_w) / 2;
  int compose_y = s_compose_bubble_y - s_chat_scroll_offset;
  return GRect(compose_x, compose_y, compose_w, COMPOSE_BUBBLE_H);
}

#if TOUCH_KEYBOARD_AVAILABLE
// ---------------------------------------------------------------------------
// On-screen keyboard (touch watches: Pebble Time 2 / Emery, Round 2 / Gabbro)
//
// Layout is 20 "units" wide per row so every row lines up:
//   row 0: 10 letters x 2 units
//   row 1:  9 letters x 2 units, centred (1 unit pad each side)
//   row 2: shift 3 + 7 letters x 2 + delete 3
//   row 3: 123 5 + space 10 + send 5
// Taps are matched to the nearest key in the touched row, so there are no
// dead zones between keys. Keys commit on lift-off (slide to correct), except
// delete, which fires on touch-down and repeats while held.
// ---------------------------------------------------------------------------

#define KB_UNITS 20
#define KB_INPUT_H 28
#define KB_ROW_H PBL_IF_ROUND_ELSE(24, 22)
#define KB_ROWS 4
#define KB_PAD 3
#define KB_ROUND_BOTTOM_GAP 22
#define KB_REPEAT_DELAY_MS 450
#define KB_REPEAT_MS 90
#define KB_DOUBLE_TAP_MS 400

typedef enum {
  KeyNone,
  KeyChar,
  KeyShift,
  KeyDelete,
  KeySymbols,
  KeySpace,
  KeySend
} KeyKind;

typedef struct {
  KeyKind kind;
  char ch;
  int8_t row;
  int8_t index;
} KeyHit;

static const char *const KB_ALPHA[3] = {"qwertyuiop", "asdfghjkl", "zxcvbnm"};
static const char *const KB_SYMBOLS[3] = {"1234567890", "-/:;()$&@", ".,?!'\"+"};
static const char *const KB_SYMBOLS_2[3] = {"[]{}#%^*+=", "_\\|~<>`;:", ".,?!'\"@"};

static KeyboardMode s_kb_mode;
static char s_kb_draft[TOUCH_KEYBOARD_MAX_TEXT];
static char s_kb_target_id[MAX_ID];
static bool s_kb_caps_lock;
static bool s_kb_press_active;
static KeyHit s_kb_pressed;
static AppTimer *s_kb_repeat_timer;
static uint32_t s_kb_last_shift_ms;
static int s_kb_view_start;
static bool s_kb_touch_checked;
static bool s_kb_touch_ok;
static bool s_kb_awaiting_send;

static bool kb_hit_equal(KeyHit a, KeyHit b) {
  return a.kind == b.kind && a.row == b.row && a.index == b.index;
}

static uint32_t kb_now_ms(void) {
  time_t seconds;
  uint16_t millis;
  time_ms(&seconds, &millis);
  return (uint32_t)seconds * 1000 + millis;
}

// Touch arrived in PebbleOS 4.9.164, and the "non-navigational" flag in 4.32.
static WatchInfoVersion kb_firmware(void) {
  return watch_info_get_firmware_version();
}

static bool kb_firmware_at_least(int major, int minor, int patch) {
  WatchInfoVersion v = kb_firmware();
  if (v.major != major) {
    return v.major > major;
  }
  if (v.minor != minor) {
    return v.minor > minor;
  }
  return v.patch >= patch;
}

static bool touch_keyboard_supported(void) {
  if (!TOUCH_KEYBOARD_ENABLED) {
    return false;
  }
  if (!s_kb_touch_checked) {
    s_kb_touch_checked = true;
    s_kb_touch_ok = kb_firmware_at_least(4, 9, 164) && touch_service_is_enabled();
  }
  return s_kb_touch_ok;
}

static const char *const *kb_rows(void) {
  if (!s_touch_keyboard_symbols) {
    return KB_ALPHA;
  }
  return s_touch_keyboard_shift ? KB_SYMBOLS_2 : KB_SYMBOLS;
}

static int kb_block_height(void) {
  return KB_INPUT_H + (KB_ROW_H * KB_ROWS) + KB_PAD;
}

// Whole keyboard (input field + keys) in message-layer coordinates.
static GRect touch_keyboard_rect_for_bounds(GRect bounds) {
  int h = kb_block_height();
  int bottom = bounds.size.h - (ROUND_UI ? KB_ROUND_BOTTOM_GAP : 0);
  return GRect(0, PG_MAX(0, bottom - h), bounds.size.w, h);
}

// Height of the message area left visible above the keyboard.
static int touch_keyboard_viewport_height(GRect bounds) {
  return PG_MAX(1, touch_keyboard_rect_for_bounds(bounds).origin.y);
}

#if defined(PBL_ROUND)
static int kb_isqrt(int value) {
  if (value <= 0) {
    return 0;
  }
  int root = value;
  int next = (root + 1) / 2;
  while (next < root) {
    root = next;
    next = (root + value / root) / 2;
  }
  return root;
}
#endif

// Horizontal span usable between y_top and y_bottom. On round screens this is
// the circle's chord, so keys never fall off the curved edge.
static void kb_span(GRect bounds, int y_top, int y_bottom, int *x, int *w) {
  *x = 2;
  *w = bounds.size.w - 4;
#if defined(PBL_ROUND)
  if (s_messages_root) {
    GRect frame = layer_get_frame(s_messages_root);
    int radius = PBL_DISPLAY_WIDTH / 2;
    int cy = PBL_DISPLAY_HEIGHT / 2;
    int top = y_top + frame.origin.y - cy;
    int bottom = y_bottom + frame.origin.y - cy;
    int dy = PG_MAX(top < 0 ? -top : top, bottom < 0 ? -bottom : bottom);
    int half = kb_isqrt((radius * radius) - (dy * dy)) - 4;
    half = PG_MAX(24, PG_MIN(half, bounds.size.w / 2 - 2));
    *x = (PBL_DISPLAY_WIDTH / 2) - frame.origin.x - half;
    *w = half * 2;
  }
#endif
}

static int kb_row_top(GRect keyboard_rect, int row) {
  return keyboard_rect.origin.y + KB_INPUT_H + (row * KB_ROW_H);
}

// Unit range [start, start + count) for a key in a row.
static void kb_key_units(int row, int index, int *start, int *count) {
  if (row == 0) {
    *start = index * 2;
    *count = 2;
  } else if (row == 1) {
    *start = 1 + index * 2;
    *count = 2;
  } else if (row == 2) {
    if (index == 0) {
      *start = 0;
      *count = 3;
    } else if (index == 8) {
      *start = 17;
      *count = 3;
    } else {
      *start = 3 + (index - 1) * 2;
      *count = 2;
    }
  } else {
    static const int starts[3] = {0, 5, 15};
    static const int counts[3] = {5, 10, 5};
    *start = starts[index];
    *count = counts[index];
  }
}

static int kb_row_key_count(int row) {
  return row == 0 ? 10 : row == 1 ? 9 : row == 2 ? 9 : 3;
}

static KeyHit kb_key_at(int row, int index) {
  KeyHit hit = {KeyNone, '\0', (int8_t)row, (int8_t)index};
  const char *const *rows = kb_rows();
  if (row == 0 || row == 1) {
    hit.kind = KeyChar;
    hit.ch = rows[row][index];
  } else if (row == 2) {
    if (index == 0) {
      hit.kind = KeyShift;
    } else if (index == 8) {
      hit.kind = KeyDelete;
    } else {
      hit.kind = KeyChar;
      hit.ch = rows[2][index - 1];
    }
  } else if (row == 3) {
    hit.kind = index == 0 ? KeySymbols : index == 1 ? KeySpace : KeySend;
  }
  return hit;
}

static GRect kb_key_rect(GRect bounds, GRect keyboard_rect, int row, int index) {
  int top = kb_row_top(keyboard_rect, row);
  int x;
  int w;
  int start;
  int count;
  kb_span(bounds, top, top + KB_ROW_H, &x, &w);
  kb_key_units(row, index, &start, &count);
  int left = x + (w * start) / KB_UNITS;
  int right = x + (w * (start + count)) / KB_UNITS;
  return GRect(left + 1, top + 1, PG_MAX(1, right - left - 2), KB_ROW_H - 2);
}

static KeyHit kb_hit_test(GRect bounds, GPoint point) {
  KeyHit none = {KeyNone, '\0', -1, -1};
  GRect keyboard_rect = touch_keyboard_rect_for_bounds(bounds);
  int rows_top = kb_row_top(keyboard_rect, 0);
  int rows_bottom = kb_row_top(keyboard_rect, KB_ROWS);
  // A little slack above the top row and below the bottom row.
  if (point.y < rows_top - 6 || point.y > rows_bottom + 10) {
    return none;
  }
  int row = PG_MAX(0, PG_MIN(KB_ROWS - 1, (point.y - rows_top) / KB_ROW_H));
  int top = kb_row_top(keyboard_rect, row);
  int x;
  int w;
  kb_span(bounds, top, top + KB_ROW_H, &x, &w);
  int unit = w > 0 ? ((point.x - x) * KB_UNITS) / w : 0;
  unit = PG_MAX(0, PG_MIN(KB_UNITS - 1, unit));
  int count = kb_row_key_count(row);
  for (int i = 0; i < count; i++) {
    int start;
    int units;
    kb_key_units(row, i, &start, &units);
    if (unit < start + units || i == count - 1) {
      return kb_key_at(row, i);
    }
  }
  return none;
}

static bool kb_sentence_start(void) {
  size_t len = strlen(s_kb_draft);
  if (len == 0) {
    return true;
  }
  if (s_kb_draft[len - 1] != ' ') {
    return false;
  }
  while (len > 0 && s_kb_draft[len - 1] == ' ') {
    len--;
  }
  if (len == 0) {
    return true;
  }
  char last = s_kb_draft[len - 1];
  return last == '.' || last == '!' || last == '?';
}

// Auto-capitalise the first letter of the message and of each sentence.
static void kb_update_auto_shift(void) {
  if (s_touch_keyboard_symbols || s_kb_caps_lock || s_kb_mode == KeyboardModeEdit) {
    return;
  }
  s_touch_keyboard_shift = kb_sentence_start();
}

static int kb_input_text_width(void) {
  GRect bounds = s_messages_root ? layer_get_bounds(s_messages_root) : GRect(0, 0, 200, 200);
  GRect keyboard_rect = touch_keyboard_rect_for_bounds(bounds);
  int x;
  int w;
  kb_span(bounds, keyboard_rect.origin.y, keyboard_rect.origin.y + KB_INPUT_H, &x, &w);
  return PG_MAX(20, w - 24);
}

static int kb_text_width(const char *text) {
  if (!text[0]) {
    return 0;
  }
  GSize size = graphics_text_layout_get_content_size(
    text, fonts_get_system_font(FONT_KEY_GOTHIC_18), GRect(0, 0, 2000, 24),
    GTextOverflowModeFill, GTextAlignmentLeft);
  return size.w;
}

static bool kb_is_continuation(char c) {
  return ((unsigned char)c & 0xc0) == 0x80;
}

// Keep the end of the draft (where you are typing) visible in the input field.
static void kb_update_view(void) {
  int available = kb_input_text_width();
  int len = (int)strlen(s_kb_draft);
  int start = PG_MIN(s_kb_view_start, len);
  if (kb_text_width(s_kb_draft) <= available) {
    s_kb_view_start = 0;
    return;
  }
  while (start > 0 && kb_is_continuation(s_kb_draft[start])) {
    start--;
  }
  // Move the window left if we deleted back into it.
  while (start > 0 && kb_text_width(s_kb_draft + start) < available - 30) {
    start = PG_MAX(0, start - 4);
    while (start > 0 && kb_is_continuation(s_kb_draft[start])) {
      start--;
    }
  }
  // Move it right until the tail fits.
  while (start < len && kb_text_width(s_kb_draft + start) > available) {
    start += 3;
    while (start < len && kb_is_continuation(s_kb_draft[start])) {
      start++;
    }
  }
  s_kb_view_start = PG_MIN(start, len);
}

static void kb_dirty(void) {
  if (s_messages_root) {
    layer_mark_dirty(s_messages_root);
  }
}

static void kb_draft_changed(void) {
  kb_update_view();
  kb_update_auto_shift();
  kb_dirty();
}

static void kb_append(const char *text) {
  size_t current = strlen(s_kb_draft);
  size_t add = strlen(text);
  if (current + add + 1 > sizeof(s_kb_draft)) {
    show_status("Message full");
    vibes_short_pulse();
    return;
  }
  memcpy(s_kb_draft + current, text, add + 1);
}

static void kb_type_char(char ch) {
  if (!s_touch_keyboard_symbols && s_touch_keyboard_shift && ch >= 'a' && ch <= 'z') {
    ch = (char)(ch - 'a' + 'A');
  }
  char text[2] = {ch, '\0'};
  kb_append(text);
  if (!s_kb_caps_lock && !s_touch_keyboard_symbols) {
    s_touch_keyboard_shift = false;
  }
  kb_draft_changed();
}

// Deletes one whole character, including multi-byte UTF-8 (emoji in an edit).
static void kb_delete(void) {
  size_t len = strlen(s_kb_draft);
  if (len == 0) {
    return;
  }
  len--;
  while (len > 0 && kb_is_continuation(s_kb_draft[len])) {
    len--;
  }
  s_kb_draft[len] = '\0';
  kb_draft_changed();
}

static void kb_cancel_repeat(void) {
  if (s_kb_repeat_timer) {
    app_timer_cancel(s_kb_repeat_timer);
    s_kb_repeat_timer = NULL;
  }
}

static void kb_repeat_callback(void *context) {
  s_kb_repeat_timer = NULL;
  if (!s_touch_keyboard_open || !s_kb_press_active || s_kb_pressed.kind != KeyDelete ||
      !s_kb_draft[0]) {
    return;
  }
  kb_delete();
  s_kb_repeat_timer = app_timer_register(KB_REPEAT_MS, kb_repeat_callback, NULL);
}

static void kb_reset_press(void) {
  kb_cancel_repeat();
  s_kb_press_active = false;
  s_kb_pressed.kind = KeyNone;
  s_kb_pressed.row = -1;
  s_kb_pressed.index = -1;
}

static const char *kb_placeholder(void) {
  switch (s_kb_mode) {
    case KeyboardModeReply:
      return "Reply...";
    case KeyboardModeEdit:
      return "Edit message...";
    case KeyboardModeCompose:
      break;
  }
  return "Message...";
}

static const char *kb_send_label(void) {
  return s_kb_mode == KeyboardModeEdit ? "save" : "send";
}

static void close_touch_keyboard(void) {
  kb_reset_press();
  if (!s_touch_keyboard_open) {
    return;
  }
  // The draft is kept, so reopening the keyboard picks up where you left off.
  s_touch_keyboard_open = false;
  if (s_messages_root) {
    recalc_message_layout();
    layer_mark_dirty(s_messages_root);
  }
}

// Forget the draft entirely (after sending, or when switching chats).
static void reset_touch_keyboard(void) {
  close_touch_keyboard();
  s_kb_draft[0] = '\0';
  s_kb_target_id[0] = '\0';
  s_kb_mode = KeyboardModeCompose;
  s_kb_view_start = 0;
  s_kb_caps_lock = false;
  s_touch_keyboard_symbols = false;
  s_touch_keyboard_shift = false;
}

static void open_touch_keyboard(KeyboardMode mode, const char *target_id, const char *initial_text) {
  if (!touch_keyboard_supported() || s_view_state != ViewStateChat || !s_messages_root) {
    return;
  }
  if (mode == KeyboardModeCompose && s_kb_draft[0]) {
    // "New message" / "Keyboard" resumes whatever you were typing.
    mode = s_kb_mode;
    target_id = s_kb_target_id[0] ? s_kb_target_id : NULL;
  }
  bool same_target = mode == s_kb_mode &&
                     strcmp(s_kb_target_id, target_id ? target_id : "") == 0;
  if (!same_target) {
    // Different conversation target: start fresh (edits start from the message text).
    s_kb_draft[0] = '\0';
    s_kb_view_start = 0;
  }
  s_kb_mode = mode;
  copy_cstr(s_kb_target_id, sizeof(s_kb_target_id), target_id);
  if (initial_text && !s_kb_draft[0]) {
    copy_cstr(s_kb_draft, sizeof(s_kb_draft), initial_text);
  }
  s_touch_keyboard_open = true;
  s_touch_keyboard_symbols = false;
  s_kb_caps_lock = false;
  s_touch_keyboard_shift = false;
  kb_reset_press();
  kb_update_view();
  kb_update_auto_shift();
  show_status(mode == KeyboardModeEdit ? "Edit message" : mode == KeyboardModeReply ? "Reply" :
                                                                                       "Type message");
  recalc_message_layout();
  set_chat_scroll_offset(s_chat_content_height, true);
  layer_mark_dirty(s_messages_root);
}

static void kb_mark_pending_failed(void) {
  int index = find_message_index_by_id("pending");
  if (index >= 0) {
    Message *message = &s_messages[index];
    char text[TOUCH_KEYBOARD_MAX_TEXT];
    copy_cstr(text, sizeof(text), message->text);
    set_message_strings(message, NULL, text, NULL, "not sent", NULL);
    copy_cstr(message->id, sizeof(message->id), "failed");
  }
  if (!s_kb_draft[0]) {
    copy_cstr(s_kb_draft, sizeof(s_kb_draft), s_touch_keyboard_sent_text);
    s_kb_view_start = 0;
  }
  s_touch_keyboard_sent_text[0] = '\0';
  s_kb_awaiting_send = false;
  if (s_messages_root) {
    recalc_message_layout();
    layer_mark_dirty(s_messages_root);
  }
}

// Called from the inbox for "sent" / "error" replies.
static bool touch_keyboard_has_draft(void) {
  return s_kb_draft[0] != '\0';
}

static void touch_keyboard_send_result(bool ok) {
  if (!s_kb_awaiting_send) {
    return;
  }
  if (ok) {
    s_kb_awaiting_send = false;
    int index = find_message_index_by_id("pending");
    if (index >= 0) {
      Message *message = &s_messages[index];
      char text[TOUCH_KEYBOARD_MAX_TEXT];
      copy_cstr(text, sizeof(text), message->text);
      set_message_strings(message, NULL, text, NULL, "sent", NULL);
      kb_dirty();
    }
  } else {
    kb_mark_pending_failed();
    show_status("Not sent - reopen keyboard to retry");
  }
}

static void kb_trim_trailing_spaces(char *text) {
  size_t len = strlen(text);
  while (len > 0 && (text[len - 1] == ' ' || text[len - 1] == '\n')) {
    text[--len] = '\0';
  }
}

static void kb_send(void) {
  char text[TOUCH_KEYBOARD_MAX_TEXT];
  copy_cstr(text, sizeof(text), s_kb_draft);
  kb_trim_trailing_spaces(text);
  if (!text[0]) {
    show_status("Type a message first");
    return;
  }

  if (s_kb_mode == KeyboardModeEdit) {
    if (!s_kb_target_id[0]) {
      show_status("No edit target");
      return;
    }
    show_status("Editing...");
    if (!send_command("edit_message", s_current_chat_id, text, NULL, s_kb_target_id)) {
      return;  // Busy: keep the keyboard open so nothing is lost.
    }
    reset_touch_keyboard();
    return;
  }

  const char *reply_to = (s_kb_mode == KeyboardModeReply && s_kb_target_id[0]) ? s_kb_target_id : NULL;
  show_status("Sending...");
  if (!send_command("send_message", s_current_chat_id, text, reply_to, NULL)) {
    return;  // Busy: keep the draft and keyboard so the user can tap send again.
  }

  copy_cstr(s_touch_keyboard_sent_text, sizeof(s_touch_keyboard_sent_text), text);
  s_kb_awaiting_send = true;
  reset_touch_keyboard();

  // Show the message straight away; the real one replaces it when it arrives.
  int stale = find_message_index_by_id("failed");
  if (stale >= 0) {
    remove_message_at(stale);
  }
  Message *slot = append_message_slot();
  copy_cstr(slot->id, sizeof(slot->id), "pending");
  set_message_strings(slot, NULL, text, NULL, "...", NULL);
  slot->outgoing = true;
  s_at_newest = true;
  s_user_scrolled_messages = false;
  s_selected_message = s_message_count - 1;
  if (s_messages_root) {
    recalc_message_layout();
    set_chat_scroll_offset(s_chat_content_height, true);
    layer_mark_dirty(s_messages_root);
  }
}

static void kb_activate(KeyHit hit) {
  switch (hit.kind) {
    case KeyChar:
      kb_type_char(hit.ch);
      return;
    case KeySpace:
      kb_append(" ");
      kb_draft_changed();
      return;
    case KeyShift: {
      uint32_t now = kb_now_ms();
      if (s_touch_keyboard_symbols) {
        s_touch_keyboard_shift = !s_touch_keyboard_shift;  // second symbols page
      } else if (s_kb_caps_lock) {
        s_kb_caps_lock = false;
        s_touch_keyboard_shift = false;
      } else if (s_touch_keyboard_shift && now - s_kb_last_shift_ms < KB_DOUBLE_TAP_MS) {
        s_kb_caps_lock = true;  // double-tap shift = caps lock
      } else {
        s_touch_keyboard_shift = !s_touch_keyboard_shift;
      }
      s_kb_last_shift_ms = now;
      kb_dirty();
      return;
    }
    case KeySymbols:
      s_touch_keyboard_symbols = !s_touch_keyboard_symbols;
      s_touch_keyboard_shift = false;
      s_kb_caps_lock = false;
      kb_update_auto_shift();
      kb_dirty();
      return;
    case KeySend:
      kb_send();
      return;
    case KeyDelete:
    case KeyNone:
      return;
  }
}

static void draw_touch_keyboard_key(GContext *ctx, GRect rect, const char *label, bool pressed,
                                    bool special, bool accent) {
  GColor fill = pressed ? APP_COLOR : accent ? APP_COLOR : special ? GColorLightGray : GColorWhite;
  GColor text = (pressed || accent) ? GColorWhite : GColorBlack;
  if (pressed && accent) {
    fill = GColorPictonBlue;
  }
  graphics_context_set_fill_color(ctx, fill);
  graphics_fill_rect(ctx, rect, 3, GCornersAll);
  graphics_context_set_text_color(ctx, text);
  GFont font = fonts_get_system_font(strlen(label) > 1 ? FONT_KEY_GOTHIC_14_BOLD : FONT_KEY_GOTHIC_18_BOLD);
  int text_y = rect.origin.y + (strlen(label) > 1 ? 2 : -2);
  graphics_draw_text(ctx, label, font, GRect(rect.origin.x, text_y, rect.size.w, rect.size.h),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
}

// Shift is a drawn up arrow: outline when off, filled when on, with a bar
// underneath for caps lock. Fonts can't be relied on for an arrow glyph.
static void kb_draw_shift_arrow(GContext *ctx, GRect rect, GColor color, bool filled, bool caps) {
  int cx = rect.origin.x + rect.size.w / 2;
  int size = PG_MIN(rect.size.w - 4, rect.size.h - 6);
  int half = PG_MAX(3, size / 2);
  int top = rect.origin.y + (rect.size.h - size) / 2 - (caps ? 1 : 0);
  int mid = top + half;
  int stem_w = PG_MAX(2, half / 2);
  int bottom = top + size - (caps ? 2 : 0);
  GPoint points[7] = {
    {cx, top},
    {cx + half, mid},
    {cx + stem_w, mid},
    {cx + stem_w, bottom},
    {cx - stem_w, bottom},
    {cx - stem_w, mid},
    {cx - half, mid}
  };
  GPathInfo info = {7, points};
  GPath *path = gpath_create(&info);
  if (!path) {
    return;
  }
  graphics_context_set_fill_color(ctx, color);
  graphics_context_set_stroke_color(ctx, color);
  if (filled) {
    gpath_draw_filled(ctx, path);
  }
  gpath_draw_outline(ctx, path);
  gpath_destroy(path);
  if (caps) {
    graphics_fill_rect(ctx, GRect(cx - half + 1, bottom + 2, (half * 2) - 1, 2), 0, GCornerNone);
  }
}

static void kb_key_label(KeyHit key, char *buffer, size_t size) {
  switch (key.kind) {
    case KeyChar:
      buffer[0] = key.ch;
      if (!s_touch_keyboard_symbols && s_touch_keyboard_shift && key.ch >= 'a' && key.ch <= 'z') {
        buffer[0] = (char)(key.ch - 'a' + 'A');
      }
      buffer[1] = '\0';
      return;
    case KeyShift:
      copy_cstr(buffer, size, s_touch_keyboard_symbols ? (s_touch_keyboard_shift ? "123" : "#+=") :
                              s_kb_caps_lock ? "CAPS" : s_touch_keyboard_shift ? "SHIFT" : "shift");
      return;
    case KeyDelete:
      copy_cstr(buffer, size, "del");
      return;
    case KeySymbols:
      copy_cstr(buffer, size, s_touch_keyboard_symbols ? "ABC" : "123");
      return;
    case KeySpace:
      copy_cstr(buffer, size, "space");
      return;
    case KeySend:
      copy_cstr(buffer, size, kb_send_label());
      return;
    case KeyNone:
      break;
  }
  buffer[0] = '\0';
}

// Big preview of the key under your finger, drawn well above it so the finger
// doesn't hide it: a keyboard-coloured rounded square with a tapered tail
// pointing down toward the key. It follows the finger while sliding.
#define KB_PREVIEW_W 36
#define KB_PREVIEW_H 40
#define KB_PREVIEW_GAP 48
#define KB_PREVIEW_TAIL 12

static void kb_draw_key_preview(GContext *ctx, GRect bounds, GRect key_rect, KeyHit key) {
  char label[2] = {key.ch, '\0'};
  if (!s_touch_keyboard_symbols && s_touch_keyboard_shift && key.ch >= 'a' && key.ch <= 'z') {
    label[0] = (char)(key.ch - 'a' + 'A');
  }
  int key_cx = key_rect.origin.x + key_rect.size.w / 2;
  int head_bottom = key_rect.origin.y - KB_PREVIEW_GAP;
  int head_top = PG_MAX(2, head_bottom - KB_PREVIEW_H);
  head_bottom = head_top + KB_PREVIEW_H;

  // Keep the bubble on screen (inside the circle on Round 2).
  int span_x;
  int span_w;
  kb_span(bounds, head_top, head_bottom, &span_x, &span_w);
  int head_x = key_cx - KB_PREVIEW_W / 2;
  head_x = PG_MAX(span_x, PG_MIN(head_x, span_x + span_w - KB_PREVIEW_W));
  GRect head = GRect(head_x, head_top, KB_PREVIEW_W, KB_PREVIEW_H);

  // Tail: tapers from the bottom of the square toward the pressed key.
  int tail_cx = PG_MAX(head.origin.x + 8, PG_MIN(key_cx, head.origin.x + KB_PREVIEW_W - 8));
  GPoint tail_points[3] = {
    {tail_cx - 9, head_bottom - 2},
    {tail_cx + 9, head_bottom - 2},
    {tail_cx, head_bottom + KB_PREVIEW_TAIL}
  };
  GPathInfo tail_info = {3, tail_points};
  GPath *tail = gpath_create(&tail_info);

  // Outline in the keyboard's dark grey, then the white key face.
  graphics_context_set_fill_color(ctx, GColorDarkGray);
  graphics_fill_rect(ctx, grect_inset(head, GEdgeInsets(-2)), 8, GCornersAll);
  if (tail) {
    graphics_context_set_stroke_color(ctx, GColorDarkGray);
    graphics_context_set_stroke_width(ctx, 3);
    gpath_draw_outline(ctx, tail);
    graphics_context_set_stroke_width(ctx, 1);
  }
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, head, 6, GCornersAll);
  if (tail) {
    gpath_draw_filled(ctx, tail);
    gpath_destroy(tail);
  }
  // Accent bar ties it to the pressed-key colour.
  graphics_context_set_fill_color(ctx, APP_COLOR);
  graphics_fill_rect(ctx, GRect(head.origin.x + 6, head.origin.y + head.size.h - 5, head.size.w - 12, 2),
                     0, GCornerNone);

  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, label, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(head.origin.x, head.origin.y + 1, head.size.w, head.size.h - 6),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
}

static void draw_touch_keyboard(GContext *ctx, GRect bounds) {
  GRect keyboard_rect = touch_keyboard_rect_for_bounds(bounds);
  graphics_context_set_fill_color(ctx, GColorDarkGray);
  graphics_fill_rect(ctx, GRect(0, keyboard_rect.origin.y, bounds.size.w,
                                bounds.size.h - keyboard_rect.origin.y), 0, GCornerNone);

  // Input field
  int span_x;
  int span_w;
  kb_span(bounds, keyboard_rect.origin.y, keyboard_rect.origin.y + KB_INPUT_H, &span_x, &span_w);
  GRect input_rect = GRect(span_x + 4, keyboard_rect.origin.y + 3, span_w - 8, KB_INPUT_H - 5);
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, input_rect, 6, GCornersAll);
  graphics_context_set_stroke_color(ctx, APP_COLOR);
  graphics_draw_round_rect(ctx, input_rect, 6);
  GRect text_rect = GRect(input_rect.origin.x + 6, input_rect.origin.y - 1,
                          input_rect.size.w - 12, input_rect.size.h);
  if (s_kb_draft[0]) {
    const char *visible = s_kb_draft + PG_MIN(s_kb_view_start, (int)strlen(s_kb_draft));
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, visible, fonts_get_system_font(FONT_KEY_GOTHIC_18), text_rect,
                       GTextOverflowModeFill, GTextAlignmentLeft, NULL);
    int cursor_x = text_rect.origin.x + PG_MIN(text_rect.size.w - 2, kb_text_width(visible) + 1);
    graphics_context_set_fill_color(ctx, APP_COLOR);
    graphics_fill_rect(ctx, GRect(cursor_x, input_rect.origin.y + 4, 2, input_rect.size.h - 8),
                       0, GCornerNone);
  } else {
    graphics_context_set_text_color(ctx, GColorDarkGray);
    graphics_draw_text(ctx, kb_placeholder(), fonts_get_system_font(FONT_KEY_GOTHIC_18), text_rect,
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }

  // Keys
  char label[8];
  for (int row = 0; row < KB_ROWS; row++) {
    int count = kb_row_key_count(row);
    for (int i = 0; i < count; i++) {
      KeyHit key = kb_key_at(row, i);
      bool pressed = s_kb_press_active && kb_hit_equal(key, s_kb_pressed);
      bool special = key.kind != KeyChar && key.kind != KeySpace;
      bool accent = key.kind == KeySend ||
                    (key.kind == KeyShift && !s_touch_keyboard_symbols &&
                     (s_touch_keyboard_shift || s_kb_caps_lock));
      GRect key_rect = kb_key_rect(bounds, keyboard_rect, row, i);
      if (key.kind == KeyShift && !s_touch_keyboard_symbols) {
        draw_touch_keyboard_key(ctx, key_rect, "", pressed, special, accent);
        kb_draw_shift_arrow(ctx, key_rect, (pressed || accent) ? GColorWhite : GColorBlack,
                            s_touch_keyboard_shift || s_kb_caps_lock, s_kb_caps_lock);
        continue;
      }
      kb_key_label(key, label, sizeof(label));
      draw_touch_keyboard_key(ctx, key_rect, label, pressed, special, accent);
    }
  }

  if (s_kb_press_active && s_kb_pressed.kind == KeyChar) {
    kb_draw_key_preview(ctx, bounds, kb_key_rect(bounds, keyboard_rect, s_kb_pressed.row,
                                                 s_kb_pressed.index), s_kb_pressed);
  }
}

static void touch_handler(const TouchEvent *event, void *context) {
  if (!event || !touch_keyboard_supported()) {
    return;
  }
  // Menus, dictation and full-text views sit above the chat: ignore touches then.
  if (window_stack_get_top_window() != s_main_window || s_view_state != ViewStateChat ||
      !s_messages_root) {
    kb_reset_press();
    return;
  }
  // A touch that woke the screen shouldn't type (flag exists from PebbleOS 4.32).
  if (event->non_navigational && kb_firmware_at_least(4, 32, 0)) {
    return;
  }

  GRect bounds = layer_get_bounds(s_messages_root);
  GRect frame = layer_get_frame(s_messages_root);
  GPoint point = GPoint(event->x - frame.origin.x, event->y - frame.origin.y);

  if (!s_touch_keyboard_open) {
    if (event->type == TouchEvent_Liftoff && s_at_newest) {
      GRect compose_rect = compose_rect_for_bounds(bounds);
      if (grect_contains_point(&compose_rect, &point)) {
        open_touch_keyboard(KeyboardModeCompose, NULL, NULL);
      }
    }
    return;
  }

  KeyHit hit = kb_hit_test(bounds, point);
  switch (event->type) {
    case TouchEvent_Touchdown:
      kb_reset_press();
      s_kb_press_active = hit.kind != KeyNone;
      s_kb_pressed = hit;
      if (hit.kind == KeyDelete) {
        kb_delete();
        s_kb_repeat_timer = app_timer_register(KB_REPEAT_DELAY_MS, kb_repeat_callback, NULL);
      }
      kb_dirty();
      break;
    case TouchEvent_PositionUpdate:
      if (s_kb_press_active && !kb_hit_equal(hit, s_kb_pressed) &&
          s_kb_pressed.kind != KeyDelete) {
        // Slide to correct: the highlight follows your finger.
        s_kb_pressed = hit;
        kb_dirty();
      }
      break;
    case TouchEvent_Liftoff: {
      bool was_active = s_kb_press_active;
      KeyHit pressed = s_kb_pressed;
      kb_reset_press();
      if (was_active && pressed.kind != KeyDelete && hit.kind != KeyNone) {
        kb_activate(hit);
      }
      kb_dirty();
      break;
    }
  }
}
#else
static bool touch_keyboard_supported(void) {
  return false;
}

static void close_touch_keyboard(void) {
}

static void reset_touch_keyboard(void) {
}

static void open_touch_keyboard(KeyboardMode mode, const char *target_id, const char *initial_text) {
}

static void touch_keyboard_send_result(bool ok) {
}

static bool touch_keyboard_has_draft(void) {
  return false;
}
#endif

static void messages_root_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, CHAT_BG);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  if (s_message_count == 0) {
    graphics_context_set_text_color(ctx, GColorDarkGray);
    graphics_draw_text(ctx, s_loading_messages ? "Loading messages..." : "No messages loaded",
                       fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                       GRect(8, 40, bounds.size.w - 16, 80), GTextOverflowModeWordWrap,
                       GTextAlignmentCenter, NULL);
  }

  recalc_message_layout();
  GFont text_font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  GFont sender_font = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  GFont reaction_font = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  int first = 0;
  while (first < s_message_count - 1 &&
         s_message_y[first] + s_message_h[first] < s_chat_scroll_offset - 12) {
    first++;
  }

  for (int i = first; i < s_message_count; i++) {
    Message *message = &s_messages[i];
    char display_text[MESSAGE_PREVIEW_TEXT + 8];
    bool selected = i == s_selected_message;
    bool truncated = (int)strlen(message->text) > MESSAGE_PREVIEW_TEXT;
    int bubble_w = message_bubble_width(bounds);
    int text_w = bubble_w - 10;
    int inset = message_side_inset(bounds);
    int offset = ROUND_UI ? 6 : 0;
    int x = message->outgoing ? bounds.size.w - bubble_w - inset + offset : inset - offset;
    x = PG_MAX(2, PG_MIN(x, bounds.size.w - bubble_w - 2));
    int name_h = (!message->outgoing && message->sender[0]) ? 16 : 0;
    int reaction_h = message_reaction_height(message, text_w);
    int context_h = message_context_height(message);
    int y = s_message_y[i] - s_chat_scroll_offset;
    int bubble_h = s_message_h[i];

    if (y > bounds.size.h) {
      break;
    }

    copy_cstr(display_text, sizeof(display_text), message->text);
    if (truncated) {
      truncate_cstr_bytes(display_text, sizeof(display_text), MESSAGE_PREVIEW_TEXT, " ...");
    }

    GColor fill = BW_UI ? GColorWhite : (message->outgoing ? OUT_BUBBLE : IN_BUBBLE);
    GRect bubble = GRect(x, y, bubble_w, bubble_h);

    graphics_context_set_fill_color(ctx, fill);
    graphics_fill_rect(ctx, bubble, 6, GCornersAll);

    graphics_context_set_stroke_color(ctx, BW_UI ? GColorBlack : (selected ? APP_COLOR : GColorLightGray));
    graphics_draw_round_rect(ctx, bubble, 6);
    if (selected) {
      graphics_draw_round_rect(ctx, GRect(bubble.origin.x + 1, bubble.origin.y + 1,
                                          bubble.size.w - 2, bubble.size.h - 2), 5);
      if (BW_UI) {
        graphics_draw_round_rect(ctx, GRect(bubble.origin.x + 2, bubble.origin.y + 2,
                                            bubble.size.w - 4, bubble.size.h - 4), 4);
      }
    }

    int text_y = y + 2;
    if (name_h) {
      graphics_context_set_text_color(ctx, BW_UI ? GColorBlack : APP_COLOR);
      graphics_draw_text(ctx, message->sender, sender_font, GRect(x + 5, text_y, text_w, name_h),
                         GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
      text_y += name_h;
    }
    if (context_h) {
      draw_message_context(ctx, message, GRect(x + 5, text_y + 1, text_w, context_h - 3));
      text_y += context_h;
    }
    graphics_context_set_text_color(ctx, GColorBlack);
    int image_h = message->image_placeholder ?
                  message_image_display_height(message, message_image_frame_width(bubble_w)) + 8 : 0;
    int text_rect_h = bubble_h - name_h - context_h - image_h - reaction_h - 6;
    if (display_text[0] && text_rect_h > 0 && text_w > 4) {
      graphics_draw_text(ctx, display_text, text_font,
                         GRect(x + 5, text_y, text_w, text_rect_h),
                         GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
    }

    if (message->image_placeholder) {
      int max_image_w = message_image_frame_width(bubble_w);
      int image_w = message_image_display_width(message, max_image_w);
      int image_h = message_image_display_height(message, max_image_w);
      GRect image_rect = GRect(x + 5 + ((text_w - image_w) / 2),
                              y + bubble_h - reaction_h - image_h - 4,
                              image_w, image_h);
      if (message->image_bitmap) {
        graphics_draw_bitmap_in_rect(ctx, message->image_bitmap, image_rect);
      } else {
		        bool gif = message_is_gif(message);
		        const char *media_name = gif ? "GIF" : "Photo";
		        const char *label = message->image_failed ?
		                            (message->image_error[0] ? message->image_error : (gif ? "GIF failed" : "Photo failed")) :
		                            (message->image_requested ? "Loading..." : media_name);
		        const char *loading_detail = (!message->image_failed && message->image_requested && message->image_error[0]) ?
		                                     message->image_error : "";
        int image_percent = message->image_requested ? message->image_progress : 0;
	        graphics_context_set_stroke_color(ctx, BW_UI ? GColorBlack : GColorLightGray);
	        graphics_draw_round_rect(ctx, image_rect, 4);
	        graphics_context_set_text_color(ctx, GColorBlack);
		        int requested_h = loading_detail[0] && image_rect.size.h >= 64 ? 58 : 42;
		        int label_h = message->image_failed ? PG_MIN(image_rect.size.h - 4, 46) : 24;
		        int label_y = image_rect.origin.y + PG_MAX(2, (image_rect.size.h - (message->image_requested ? requested_h : label_h)) / 2);
		        graphics_draw_text(ctx, label, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
		                           GRect(image_rect.origin.x + 4, label_y, image_rect.size.w - 8, label_h),
		                           message->image_failed ? GTextOverflowModeWordWrap : GTextOverflowModeTrailingEllipsis,
		                           GTextAlignmentCenter, NULL);
	        if (message->image_requested && image_rect.size.h >= 48) {
	          int bar_w = PG_MIN(image_rect.size.w - 20, 112);
	          GRect bar = GRect(image_rect.origin.x + ((image_rect.size.w - bar_w) / 2),
	                            label_y + 28, bar_w, 10);
	          draw_loading_bar(ctx, bar, image_percent);
	          if (loading_detail[0] && image_rect.size.h >= 64) {
	            graphics_context_set_text_color(ctx, GColorDarkGray);
	            graphics_draw_text(ctx, loading_detail, fonts_get_system_font(FONT_KEY_GOTHIC_14),
	                               GRect(image_rect.origin.x + 4, label_y + 40, image_rect.size.w - 8, 18),
	                               GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
	          }
	        }
	      }
	    }

    if (reaction_h > 0) {
      int meta_w = message->meta[0] ? PG_MIN(50, text_w) : 0;
      graphics_context_set_text_color(ctx, BW_UI ? GColorBlack : GColorDarkGray);
      if (message->reactions[0]) {
        graphics_draw_text(ctx, message->reactions, reaction_font,
                           GRect(x + 7, y + bubble_h - reaction_h - 1,
                                 text_w - meta_w - 6, reaction_h),
                           GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
      }
      if (message->meta[0]) {
        draw_message_meta(ctx, message->meta, reaction_font,
                          GRect(x + bubble_w - meta_w - 7, y + bubble_h - REACTION_LINE_H - 1,
                                meta_w, REACTION_LINE_H));
      }
    }
  }

  GRect compose_rect = compose_rect_for_bounds(bounds);
  int compose_y = compose_rect.origin.y;
  bool compose_selected = compose_target_is_selected();
  if (s_at_newest && !s_touch_keyboard_open &&
      compose_y < bounds.size.h && compose_y + COMPOSE_BUBBLE_H > 0) {
    graphics_context_set_fill_color(ctx, BW_UI ? GColorWhite : GColorLightGray);
    graphics_fill_rect(ctx, compose_rect, COMPOSE_BUBBLE_H / 2, GCornersAll);
    graphics_context_set_stroke_color(ctx, BW_UI ? GColorBlack : (compose_selected ? APP_COLOR : GColorDarkGray));
    graphics_draw_round_rect(ctx, compose_rect, COMPOSE_BUBBLE_H / 2);
    if (compose_selected) {
      graphics_draw_round_rect(ctx, GRect(compose_rect.origin.x + 1, compose_rect.origin.y + 1,
                                          compose_rect.size.w - 2, compose_rect.size.h - 2),
                               (COMPOSE_BUBBLE_H / 2) - 1);
    }
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, touch_keyboard_has_draft() ? "Continue draft" : "New message",
                       fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(compose_rect.origin.x + 8, compose_rect.origin.y + 3,
                             compose_rect.size.w - 16, compose_rect.size.h - 5),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }

#if TOUCH_KEYBOARD_AVAILABLE
  if (s_touch_keyboard_open) {
    draw_touch_keyboard(ctx, bounds);
  }
#endif
}

static void destroy_chat_view(void) {
  if (s_chat_menu_animation) {
    animation_unschedule((Animation *)s_chat_menu_animation);
    property_animation_destroy(s_chat_menu_animation);
    s_chat_menu_animation = NULL;
  }
  if (s_messages_animation) {
    animation_unschedule((Animation *)s_messages_animation);
    property_animation_destroy(s_messages_animation);
    s_messages_animation = NULL;
  }
  if (s_chat_scroll_timer) {
    app_timer_cancel(s_chat_scroll_timer);
    s_chat_scroll_timer = NULL;
  }
  if (s_messages_root) {
    layer_destroy(s_messages_root);
    s_messages_root = NULL;
  }
}

static void clear_layer_animation(PropertyAnimation **animation_ref) {
  if (*animation_ref) {
    animation_unschedule((Animation *)*animation_ref);
    property_animation_destroy(*animation_ref);
    *animation_ref = NULL;
  }
}

static void generic_layer_animation_stopped(Animation *animation, bool finished, void *context) {
  PropertyAnimation **animation_ref = (PropertyAnimation **)context;
  if (animation_ref && *animation_ref) {
    property_animation_destroy(*animation_ref);
    *animation_ref = NULL;
  }
}

static void chat_menu_slide_out_stopped(Animation *animation, bool finished, void *context) {
  generic_layer_animation_stopped(animation, finished, &s_chat_menu_animation);
  if (finished && s_view_state == ViewStateChat && s_chat_menu) {
    layer_set_hidden(menu_layer_get_layer(s_chat_menu), true);
  }
}

static void messages_slide_back_stopped(Animation *animation, bool finished, void *context) {
  generic_layer_animation_stopped(animation, finished, &s_messages_animation);
  if (finished && s_view_state == ViewStateChatList && s_messages_root) {
    layer_destroy(s_messages_root);
    s_messages_root = NULL;
  }
}

static void animate_layer_frame(PropertyAnimation **animation_ref, Layer *layer,
                                GRect from_frame, GRect to_frame,
                                AnimationStoppedHandler stopped_handler) {
  clear_layer_animation(animation_ref);
  layer_set_frame(layer, from_frame);
  *animation_ref = property_animation_create_layer_frame(layer, &from_frame, &to_frame);
  if (!*animation_ref) {
    layer_set_frame(layer, to_frame);
    return;
  }
  Animation *animation = (Animation *)*animation_ref;
  animation_set_duration(animation, VIEW_TRANSITION_MS);
  animation_set_curve(animation, AnimationCurveEaseOut);
  animation_set_handlers(animation, (AnimationHandlers) {
    .stopped = stopped_handler ? stopped_handler : generic_layer_animation_stopped
  }, animation_ref);
  animation_schedule(animation);
}

static void show_chat_view(void) {
  s_chat_view_pending = false;
  s_view_state = ViewStateChat;
  window_set_click_config_provider(s_main_window, click_config_provider);
  destroy_chat_view();
  show_status(s_current_chat_title);

  Layer *window_layer = window_get_root_layer(s_main_window);
  GRect bounds = layer_get_bounds(window_layer);
  int content_y = chat_content_y();
  int bottom_pad = chat_bottom_pad();
  GRect messages_to = GRect(0, content_y, bounds.size.w, bounds.size.h - content_y - bottom_pad);
  GRect messages_from = messages_to;
  messages_from.origin.x = bounds.size.w;
  s_messages_root = layer_create(messages_from);
  layer_set_update_proc(s_messages_root, messages_root_update_proc);
  layer_add_child(window_layer, s_messages_root);
  s_chat_scroll_offset = 0;
  s_chat_content_height = 0;
  recalc_message_layout();
  if (s_message_count > 0) {
    s_chat_scroll_offset = clamp_scroll_offset(s_chat_content_height);
  }
  render_messages();
  animate_layer_frame(&s_messages_animation, s_messages_root, messages_from, messages_to, NULL);
  if (s_chat_menu) {
    Layer *menu_layer = menu_layer_get_layer(s_chat_menu);
    GRect menu_from = layer_get_frame(menu_layer);
    GRect menu_to = menu_from;
    menu_from.origin.x = 0;
    menu_to.origin.x = -bounds.size.w;
    layer_set_hidden(menu_layer, false);
    animate_layer_frame(&s_chat_menu_animation, menu_layer, menu_from, menu_to,
                        chat_menu_slide_out_stopped);
  }
}

static void show_chat_view_timer(void *data) {
  show_chat_view();
}

static void render_chat_list_with_transition(void) {
  int row = s_selected_chat;
  s_view_state = ViewStateChatList;
  s_chats_loading = false;
  s_loading_error = false;
  window_set_click_config_provider(s_main_window, click_config_provider);
  if (s_chat_scroll_timer) {
    app_timer_cancel(s_chat_scroll_timer);
    s_chat_scroll_timer = NULL;
  }
  Layer *window_layer = window_get_root_layer(s_main_window);
  GRect bounds = layer_get_bounds(window_layer);
  if (s_chat_menu) {
    int saved_row = find_chat_index_by_id(s_chat_list_selected_id);
    if (saved_row >= 0) {
      row = saved_row;
    }
    Layer *menu_layer = menu_layer_get_layer(s_chat_menu);
    GRect menu_to = layer_get_frame(menu_layer);
    menu_to.origin.x = 0;
    GRect menu_from = menu_to;
    menu_from.origin.x = -bounds.size.w;
    layer_set_hidden(menu_layer, false);
    menu_layer_reload_data(s_chat_menu);
    select_chat_row(row, false);
    animate_layer_frame(&s_chat_menu_animation, menu_layer, menu_from, menu_to, NULL);
  }
  if (s_messages_root) {
    GRect messages_from = layer_get_frame(s_messages_root);
    messages_from.origin.x = 0;
    GRect messages_to = messages_from;
    messages_to.origin.x = bounds.size.w;
    animate_layer_frame(&s_messages_animation, s_messages_root, messages_from, messages_to,
                        messages_slide_back_stopped);
  }
  show_status("Pebblegram");
}

static void select_chat_row(int row, bool animated) {
  if (!s_chat_menu || s_chats_loading || s_loading_messages || s_chat_count <= 0) {
    return;
  }
  s_selected_chat = PG_MAX(0, PG_MIN(row, s_chat_count - 1));
  copy_cstr(s_chat_list_selected_id, sizeof(s_chat_list_selected_id), s_chats[s_selected_chat].id);
  menu_layer_set_selected_index(s_chat_menu, MenuIndex(0, s_selected_chat), MenuRowAlignCenter, animated);
}

static void reveal_available_chat_rows(void) {
  if (s_view_state == ViewStateChat || s_chat_count <= 0) {
    return;
  }
  s_chats_loading = false;
  s_loading_error = false;
  s_selected_chat = PG_MAX(0, PG_MIN(s_selected_chat, s_chat_count - 1));
  if (s_chat_menu) {
    menu_layer_reload_data(s_chat_menu);
    select_chat_row(s_selected_chat, false);
  }
  if (!s_chat_first_paint_reported &&
      s_chat_count >= PG_MIN(CHAT_FIRST_PAINT_ROWS, s_expected_rows > 0 ? s_expected_rows : CHAT_FIRST_PAINT_ROWS)) {
    s_chat_first_paint_reported = true;
    send_command_with_status("chat_first_paint", NULL, NULL, NULL, NULL, false);
  }
  show_status("Pebblegram");
}

static void remove_chat_at(int row) {
  if (row < 0 || row >= s_chat_count) {
    return;
  }
  clear_chat_slot(&s_chats[row]);
  for (int i = row; i < s_chat_count - 1; i++) {
    s_chats[i] = s_chats[i + 1];
  }
  memset(&s_chats[s_chat_count - 1], 0, sizeof(Chat));
  init_chat_strings(&s_chats[s_chat_count - 1]);
  s_chat_count--;
  if (s_selected_chat > row) {
    s_selected_chat--;
  }
  if (s_chat_count <= 0) {
    s_selected_chat = 0;
  } else if (s_selected_chat >= s_chat_count) {
    s_selected_chat = s_chat_count - 1;
  }
  if (s_chat_menu) {
    menu_layer_reload_data(s_chat_menu);
    select_chat_row(s_selected_chat, false);
  }
}

static void request_chats(void) {
  s_view_state = ViewStateChatList;
  cancel_message_timeout();
  if (s_chat_retry_timer) {
    app_timer_cancel(s_chat_retry_timer);
    s_chat_retry_timer = NULL;
  }
  if (s_chat_count == 0) {
    destroy_message_images();
    destroy_chat_avatars();
    s_chat_loading_progress = 0;
  }
  s_expected_rows = 0;
  s_bridge_ready = false;
  s_chats_loading = true;
  s_chat_first_paint_reported = false;
  s_chat_request_attempts = 1;
  show_loading_text("Loading...", false);
  show_status("Pebblegram");
  if (s_chat_menu) {
    menu_layer_reload_data(s_chat_menu);
  }
  send_command_with_status("get_chats", NULL, NULL, NULL, NULL, false);
  if (s_chat_request_attempts < CHAT_COMMAND_MAX_ATTEMPTS) {
    s_chat_retry_timer = app_timer_register(CHAT_COMMAND_WAKE_RETRY_MS, chat_retry_timer_callback, NULL);
  }
  schedule_message_timeout();
}

static void chat_retry_timer_callback(void *data) {
  s_chat_retry_timer = NULL;
  if (!s_chats_loading || s_view_state == ViewStateChat || s_bridge_ready ||
      s_chat_request_attempts >= CHAT_COMMAND_MAX_ATTEMPTS) {
    return;
  }

  s_chat_request_attempts++;
  send_command_with_status("get_chats", NULL, NULL, NULL, NULL, false);
  if (s_chat_request_attempts < CHAT_COMMAND_MAX_ATTEMPTS) {
    s_chat_retry_timer = app_timer_register(CHAT_COMMAND_WAKE_RETRY_MS, chat_retry_timer_callback, NULL);
  }
}

static void startup_wake_timer_callback(void *data) {
  s_startup_wake_timer = NULL;
  if (s_view_state != ViewStateChat && s_chats_loading) {
    request_chats();
  }
}

static void cancel_message_timeout(void) {
  if (s_message_timeout_timer) {
    app_timer_cancel(s_message_timeout_timer);
    s_message_timeout_timer = NULL;
  }
}

static void schedule_message_timeout(void) {
  cancel_message_timeout();
  s_message_timeout_timer = app_timer_register(MESSAGE_TRANSFER_TIMEOUT_MS, message_timeout_timer_callback, NULL);
}

static void cancel_message_retry(void) {
  if (s_message_retry_timer) {
    app_timer_cancel(s_message_retry_timer);
    s_message_retry_timer = NULL;
  }
}

static bool send_pending_message_request(void) {
  if (!s_current_chat_id[0]) {
    return false;
  }
  if (s_loading_messages) {
    return send_command_with_status("get_messages", s_current_chat_id, NULL, NULL, NULL, false);
  }
  if (s_loading_older_messages && s_message_count > 0 && s_messages[0].id[0]) {
    const char *anchor_id = s_older_anchor_id[0] ? s_older_anchor_id : s_messages[0].id;
    return send_command_with_status("get_older_messages", s_current_chat_id, NULL,
                                    s_messages[0].id, anchor_id, false);
  }
  if (s_loading_newer_messages && s_message_count > 0 && s_messages[s_message_count - 1].id[0]) {
    const char *anchor_id = s_newer_anchor_id[0] ? s_newer_anchor_id :
                            s_messages[s_message_count - 1].id;
    return send_command_with_status("get_newer_messages", s_current_chat_id, NULL,
                                    s_messages[s_message_count - 1].id, anchor_id, false);
  }
  return false;
}

static void message_retry_timer_callback(void *data) {
  s_message_retry_timer = NULL;
  if (!s_loading_messages && !s_loading_older_messages && !s_loading_newer_messages) {
    return;
  }
  if (s_message_request_attempts >= MESSAGE_COMMAND_MAX_ATTEMPTS) {
    bool had_rows = s_message_count > 0;
    s_loading_messages = false;
    s_loading_older_messages = false;
    s_loading_newer_messages = false;
    s_message_transfer_id = 0;
    s_older_anchor_id[0] = '\0';
    s_newer_anchor_id[0] = '\0';
    clear_message_stage();
    reset_message_stream_state();
    show_status(had_rows ? s_current_chat_title : "Messages failed");
    if (s_messages_root) {
      layer_mark_dirty(s_messages_root);
    }
    return;
  }
  s_message_request_attempts++;
  if (send_pending_message_request()) {
    schedule_message_timeout();
  } else {
    schedule_message_send_retry();
  }
}

static void schedule_message_send_retry(void) {
  cancel_message_retry();
  s_message_retry_timer = app_timer_register(MESSAGE_COMMAND_WAKE_RETRY_MS,
                                             message_retry_timer_callback, NULL);
}

static void message_timeout_timer_callback(void *data) {
  s_message_timeout_timer = NULL;
  if (s_chats_loading && s_view_state != ViewStateChat) {
    s_chats_loading = false;
    s_loading_error = true;
    show_loading_text("Chats failed", true);
    show_status("Pebblegram");
    if (s_chat_menu) {
      menu_layer_reload_data(s_chat_menu);
    }
    return;
  }
  if (!s_loading_messages && !s_loading_older_messages && !s_loading_newer_messages) {
    return;
  }
  bool had_rows = s_message_count > 0;
  s_loading_messages = false;
  s_loading_older_messages = false;
  s_loading_newer_messages = false;
  s_message_transfer_id = 0;
  s_older_anchor_id[0] = '\0';
  s_newer_anchor_id[0] = '\0';
  clear_message_stage();
  reset_message_stream_state();
  show_status(had_rows ? s_current_chat_title : "Messages failed");
  if (s_messages_root) {
    layer_mark_dirty(s_messages_root);
  }
}

// Load the first photo that is visible or just about to enter view. This keeps
// heap use predictable while still prefetching as the user scrolls.
static bool send_active_image_request(void) {
  if (!s_image_message_id[0]) {
    return false;
  }
  Message *message = find_message_by_image_token(s_image_message_id);
  if (!message || message->image_bitmap) {
    clear_active_image_request();
    return false;
  }
  int image_index = message_index_from_ptr(message);
  if (image_index != s_selected_message &&
      !message_image_near_viewport(image_index, IMAGE_KEEP_SCREEN_MARGIN)) {
    IMAGE_DIAG("PGIMG watch request cancel offscreen msg=%s index=%d selected=%d",
               message->image_token, image_index, s_selected_message);
    clear_active_image_request();
    return false;
  }
  unsigned budget = image_request_decode_cost_budget();
  char request_text[18];
  snprintf(request_text, sizeof(request_text), "%u:%u",
           (unsigned)message->image_retry_level,
           budget);
  IMAGE_DIAG("PGIMG watch request msg=%s attempt=%u index=%d selected=%d budget=%u heap=%u",
             message->image_token, (unsigned)message->image_retry_level,
             image_index, s_selected_message, budget, image_diag_heap_free());
  if (send_command_with_status("get_image", s_current_chat_id, request_text, NULL, message->image_token, false)) {
    schedule_image_prepare_timeout();
    return true;
  }
  schedule_image_retry();
  return false;
}

static bool retry_active_image_request(Message *message, const char *detail) {
  int image_index = message_index_from_ptr(message);
  if (!message || !message->image_token[0] ||
      image_index < 0 ||
      (image_index != s_selected_message &&
       !message_image_near_viewport(image_index, IMAGE_KEEP_SCREEN_MARGIN)) ||
      message->image_retry_level >= IMAGE_RETRY_MAX_LEVEL) {
    IMAGE_DIAG("PGIMG watch retry blocked msg=%s index=%d selected=%d attempt=%u detail=%s",
               message ? message->image_token : "(null)", image_index, s_selected_message,
               message ? (unsigned)message->image_retry_level : 0,
               detail && detail[0] ? detail : "");
    return false;
  }

  IMAGE_DIAG("PGIMG watch retry msg=%s fromAttempt=%u detail=%s heap=%u",
             message->image_token, (unsigned)message->image_retry_level,
             detail && detail[0] ? detail : "", image_diag_heap_free());
  if (s_image_retry_timer) {
    app_timer_cancel(s_image_retry_timer);
    s_image_retry_timer = NULL;
  }
  reset_image_transfer_state();
  copy_cstr(s_image_message_id, sizeof(s_image_message_id), message->image_token);
  message->image_retry_level++;
  message->image_requested = true;
  message->image_failed = false;
  message->image_progress = 0;
  copy_cstr(message->image_error, sizeof(message->image_error),
            detail && detail[0] ? detail : "Resizing");
  set_message_image_progress(message, 12);
  if (!send_active_image_request()) {
    schedule_image_retry();
  }
  if (s_messages_root) {
    layer_mark_dirty(s_messages_root);
  }
  return true;
}

static void request_next_image(void) {
  if (!s_messages_root || s_message_count == 0) {
    return;
  }
  refresh_loaded_image_count();

  if (s_image_message_id[0]) {
    Message *active_message = find_message_by_image_token(s_image_message_id);
    int active_index = message_index_from_ptr(active_message);
    if ((active_index != s_selected_message &&
         !message_image_near_viewport(active_index, IMAGE_KEEP_SCREEN_MARGIN)) ||
        (selected_message_needs_image() && active_index != s_selected_message)) {
      IMAGE_DIAG("PGIMG watch active cleared msg=%s active=%d selected=%d selectedNeeds=%d",
                 s_image_message_id, active_index, s_selected_message,
                 selected_message_needs_image() ? 1 : 0);
      clear_active_image_request();
    } else {
      return;
    }
  }

  if (s_image_message_id[0]) {
    return;
  }

  int image_index = selected_message_needs_image() ? s_selected_message : -1;
  if (image_index < 0) {
    image_index = find_best_image_candidate(true, true);
  }
  if (image_index < 0) {
    image_index = find_best_image_candidate(true, false);
  }

  if (image_index < 0) {
    return;
  }

  Message *message = &s_messages[image_index];
  IMAGE_DIAG("PGIMG watch candidate msg=%s index=%d selected=%d loaded=%d failed=%d heap=%u",
             message->image_token, image_index, s_selected_message, s_loaded_image_count,
             message->image_failed ? 1 : 0, image_diag_heap_free());
  if (image_index == s_selected_message && s_loaded_image_count > 0) {
    destroy_other_message_images(message);
  }
  refresh_loaded_image_count();

  if (s_loaded_image_count >= MAX_LOADED_IMAGES) {
    if (destroy_farthest_loaded_image()) {
      refresh_loaded_image_count();
    }
    if (s_loaded_image_count >= MAX_LOADED_IMAGES && image_index == s_selected_message &&
        destroy_unselected_loaded_image()) {
      refresh_loaded_image_count();
    }
    if (s_loaded_image_count >= MAX_LOADED_IMAGES) {
      return;
    }
  }

  message->image_failed = false;
  copy_cstr(message->image_error, sizeof(message->image_error), "Waiting phone");
  message->image_requested = true;
  set_message_image_progress(message, 5);
  copy_cstr(s_image_message_id, sizeof(s_image_message_id), message->image_token);
  free_image_transfer_buffer();
  s_image_size = 0;
  s_image_received = 0;
  s_image_expected_offset = 0;
  s_image_transfer_id = 0;
  if (!send_active_image_request()) {
    schedule_image_retry();
  }
  if (s_messages_root) {
    layer_mark_dirty(s_messages_root);
  }
}

static void image_retry_timer_callback(void *data) {
  s_image_retry_timer = NULL;
  if (!send_active_image_request()) {
    request_next_image();
  }
}

static void request_older_messages(bool silent) {
  if (s_at_oldest) {
    if (!silent) {
      show_status("No older messages");
    }
    return;
  }
  if (s_message_count <= 0 || !s_messages[0].id[0]) {
    if (!silent) {
      show_status("No older messages");
    }
    return;
  }
  if (!silent) {
    destroy_message_images();
  }
  if (s_loading_older_messages) {
    if (silent) {
      return;
    }
    cancel_message_timeout();
    cancel_message_retry();
    clear_message_stage();
    reset_message_stream_state();
    s_loading_older_messages = false;
    s_older_anchor_id[0] = '\0';
    s_older_anchor_y = 0;
  }
  recalc_message_layout();
  if (s_selected_message >= 0 && s_selected_message < s_message_count) {
    copy_cstr(s_older_anchor_id, sizeof(s_older_anchor_id), s_messages[s_selected_message].id);
    s_older_anchor_y = s_message_y[s_selected_message];
  } else {
    s_older_anchor_id[0] = '\0';
    s_older_anchor_y = 0;
  }
  s_loading_older_messages = true;
  s_message_request_attempts = 1;
  if (!silent) {
    show_status("Loading older...");
  }
  const char *anchor_id = (s_selected_message >= 0 && s_selected_message < s_message_count) ?
                          s_messages[s_selected_message].id : s_messages[0].id;
  if (!send_command_with_status("get_older_messages", s_current_chat_id, silent ? "silent" : NULL,
                                s_messages[0].id, anchor_id, !silent)) {
    if (silent) {
      s_loading_older_messages = false;
      s_older_anchor_id[0] = '\0';
      s_older_anchor_y = 0;
    } else {
      schedule_message_send_retry();
    }
  } else {
    schedule_message_timeout();
  }
}

static void request_newer_messages(bool silent) {
  if (s_message_count <= 0 || !s_messages[s_message_count - 1].id[0]) {
    if (!silent) {
      scroll_to_bottom(true);
    }
    return;
  }
  if (s_at_newest) {
    if (!silent) {
      scroll_to_bottom(true);
    }
    return;
  }
  if (s_loading_newer_messages) {
    return;
  }
  if (!silent) {
    destroy_message_images();
  }
  recalc_message_layout();
  if (s_selected_message >= 0 && s_selected_message < s_message_count) {
    copy_cstr(s_newer_anchor_id, sizeof(s_newer_anchor_id), s_messages[s_selected_message].id);
    s_newer_anchor_y = s_message_y[s_selected_message];
  } else {
    s_newer_anchor_id[0] = '\0';
    s_newer_anchor_y = 0;
  }
  s_loading_newer_messages = true;
  s_message_request_attempts = 1;
  if (!silent) {
    show_status("Loading newer...");
  }
  const char *anchor_id = (s_selected_message >= 0 && s_selected_message < s_message_count) ?
                          s_messages[s_selected_message].id : s_messages[s_message_count - 1].id;
  bool sent = send_command_with_status("get_newer_messages", s_current_chat_id, silent ? "silent" : NULL,
                                       s_messages[s_message_count - 1].id, anchor_id, !silent);
  if (!sent) {
    if (silent) {
      s_loading_newer_messages = false;
      s_newer_anchor_id[0] = '\0';
      s_newer_anchor_y = 0;
    } else {
      schedule_message_send_retry();
    }
  } else {
    schedule_message_timeout();
  }
}

static void request_messages(const char *chat_id) {
  cancel_message_timeout();
  cancel_message_retry();
  reset_touch_keyboard();
  destroy_message_images();
  clear_message_stage();
  s_loading_older_messages = false;
  s_loading_newer_messages = false;
  s_older_anchor_id[0] = '\0';
  s_newer_anchor_id[0] = '\0';
  s_older_anchor_y = 0;
  s_newer_anchor_y = 0;
  s_at_newest = true;
  s_at_oldest = false;
  s_message_scroll_direction = 0;
  s_message_count = 0;
  s_expected_rows = 0;
  s_message_transfer_id = 0;
  reset_message_stream_state();
  s_selected_message = -1;
  s_user_scrolled_messages = false;
  s_chat_view_pending = false;
  s_loading_messages = true;
  s_message_request_attempts = 1;
  show_status("Loading messages...");
  if (s_view_state != ViewStateChat || !s_messages_root) {
    s_chat_view_pending = false;
  } else {
    render_messages();
    if (s_messages_root) {
      layer_mark_dirty(s_messages_root);
    }
  }
  if (send_command_with_status("get_messages", chat_id, NULL, NULL, NULL, false)) {
    schedule_message_timeout();
  } else {
    schedule_message_send_retry();
  }
}

static void maybe_prefetch_older_messages(void) {
  if (!s_loading_older_messages && !s_at_oldest && s_message_count > 0 &&
      s_selected_message >= 0) {
    const char *anchor_id = s_messages[s_selected_message].id;
    send_command_with_status("prefetch_older_messages", s_current_chat_id, "silent",
                             s_messages[0].id, anchor_id, false);
  }
}

static void maybe_prefetch_newer_messages(void) {
  if (!s_loading_newer_messages && !s_at_newest && s_message_count > 0 &&
      s_selected_message >= 0) {
    const char *anchor_id = s_messages[s_selected_message].id;
    send_command_with_status("prefetch_newer_messages", s_current_chat_id, "silent",
                             s_messages[s_message_count - 1].id, anchor_id, false);
  }
}

static void send_text_message(const char *text, bool as_reply) {
  const char *reply_to = NULL;
  if (!text || !text[0]) {
    show_status("Nothing to send");
    return;
  }
  if (as_reply && s_selected_message >= 0 && s_selected_message < s_message_count) {
    reply_to = s_messages[s_selected_message].id;
  }
  show_status("Sending...");
  send_command("send_message", s_current_chat_id, text, reply_to, NULL);
}

static void edit_selected_message(const char *text) {
  if (!s_pending_edit_message_id[0]) {
    show_status("No edit target");
    return;
  }
  show_status("Editing...");
  send_command("edit_message", s_current_chat_id, text, NULL, s_pending_edit_message_id);
  s_pending_edit_message_id[0] = '\0';
}

static bool has_selected_message(void) {
  return s_selected_message >= 0 && s_selected_message < s_message_count;
}

static bool compose_target_is_selected(void) {
  return s_at_newest && s_selected_message == s_message_count;
}

static bool selected_message_is_truncated(void) {
  return has_selected_message() &&
         (int)strlen(s_messages[s_selected_message].text) > MESSAGE_PREVIEW_TEXT;
}

static bool selected_message_has_context(void) {
  return has_selected_message() && message_has_context(&s_messages[s_selected_message]);
}

static bool selected_message_context_is_forward(void) {
  return selected_message_has_context() &&
         strncmp(s_messages[s_selected_message].context, "Fwd from ", 9) == 0;
}

static void delete_selected_message(void) {
  if (s_selected_message < 0 || s_selected_message >= s_message_count) {
    return;
  }
  char message_id[MAX_ID];
  int delete_index = s_selected_message;
  copy_cstr(message_id, sizeof(message_id), s_messages[s_selected_message].id);
  show_status("Deleting...");
  if (send_command("delete_message", s_current_chat_id, NULL, NULL, message_id)) {
    remove_message_at(delete_index);
  }
}

// PebbleOS 4.29.0 added ~1,200 emoji to the system fonts.
static bool emoji_fonts_expanded(void) {
  static int s_expanded = -1;
  if (s_expanded < 0) {
    WatchInfoVersion version = watch_info_get_firmware_version();
    s_expanded = (version.major > 4 || (version.major == 4 && version.minor >= 29)) ? 1 : 0;
  }
  return s_expanded == 1;
}

#define ARRAY_COUNT(array) ((int)(sizeof(array) / sizeof((array)[0])))

// The last reaction slot is "Remove".
static int reaction_grid_count(void) {
  return (emoji_fonts_expanded() ? ARRAY_COUNT(REACTION_CHOICES_EXPANDED)
                                 : ARRAY_COUNT(REACTION_CHOICES_CLASSIC)) + 1;
}

static bool reaction_grid_is_remove(int index) {
  return index == reaction_grid_count() - 1;
}

static const char *reaction_grid_glyph_at(int index) {
  if (index < 0 || index >= reaction_grid_count()) {
    return "";
  }
  if (reaction_grid_is_remove(index)) {
    return "Remove";
  }
  return emoji_fonts_expanded() ? REACTION_CHOICES_EXPANDED[index] : REACTION_CHOICES_CLASSIC[index];
}

// The phone accepts the emoji itself as the reaction token.
static const char *reaction_grid_token_at(int index) {
  if (index < 0 || index >= reaction_grid_count()) {
    return "";
  }
  return reaction_grid_is_remove(index) ? "remove" : reaction_grid_glyph_at(index);
}

static int emoji_reply_count(void) {
  return emoji_fonts_expanded() ? ARRAY_COUNT(EMOJI_REPLY_CHOICES_EXPANDED)
                                : ARRAY_COUNT(EMOJI_REPLY_CHOICES_CLASSIC);
}

static const char *emoji_reply_glyph_at(int index) {
  if (index < 0 || index >= emoji_reply_count()) {
    return "";
  }
  return emoji_fonts_expanded() ? EMOJI_REPLY_CHOICES_EXPANDED[index] : EMOJI_REPLY_CHOICES_CLASSIC[index];
}

static void send_selected_reaction(const char *token) {
  if (!has_selected_message()) {
    return;
  }
  show_status((token && strcmp(token, "remove") == 0) ? "Removing..." : "Reacting...");
  send_command("send_reaction", s_current_chat_id, token, NULL, s_messages[s_selected_message].id);
}

static void send_selected_chat_action(const char *command) {
  if (s_selected_chat < 0 || s_selected_chat >= s_chat_count) {
    return;
  }
  show_status("Updating...");
  send_command(command, s_chats[s_selected_chat].id, NULL, NULL, NULL);
}

static void inbox_received_callback(DictionaryIterator *iter, void *context) {
  char *type = tuple_cstring(iter, MESSAGE_KEY_Type);
  if (!type) {
    return;
  }

  if (strcmp(type, "status") == 0) {
    char *status = tuple_cstring(iter, MESSAGE_KEY_Status);
    if (status) {
      if (s_chats_loading && s_view_state != ViewStateChat) {
        s_chats_loading = true;
        show_loading_text(status, false);
      }
      if (strcmp(status, "Loading messages...") == 0) {
        cancel_message_retry();
      }
      show_status(status);
    }
    return;
  }

  if (strcmp(type, "settings") == 0) {
    update_canned_replies(tuple_cstring(iter, MESSAGE_KEY_CannedReplies));
    return;
  }

  if (strcmp(type, "error") == 0) {
    char *error = tuple_cstring(iter, MESSAGE_KEY_Error);
    if (error && strncmp(error, "Send failed", 11) == 0) {
      touch_keyboard_send_result(false);
    }
    cancel_message_timeout();
    cancel_message_retry();
    if (s_chat_retry_timer) {
      app_timer_cancel(s_chat_retry_timer);
      s_chat_retry_timer = NULL;
    }
    if (s_view_state != ViewStateChat) {
      s_bridge_ready = false;
      s_chats_loading = true;
      show_loading_text(error ? error : "Login failed", true);
      show_status("Pebblegram");
    } else {
      s_loading_messages = false;
      s_loading_older_messages = false;
      s_loading_newer_messages = false;
      s_message_transfer_id = 0;
      show_status(error ? error : "Error");
      if (s_messages_root) {
        layer_mark_dirty(s_messages_root);
      }
    }
    return;
  }

  int index = tuple_int(iter, MESSAGE_KEY_Index, 0);
  int count = tuple_int(iter, MESSAGE_KEY_Count, 0);
  s_expected_rows = count;

  if (strcmp(type, "chats_done") == 0) {
    cancel_message_timeout();
    if (s_chat_retry_timer) {
      app_timer_cancel(s_chat_retry_timer);
      s_chat_retry_timer = NULL;
    }
    char selected_id[MAX_ID];
    copy_cstr(selected_id, sizeof(selected_id), s_chat_list_selected_id);
    if (!selected_id[0]) {
      copy_cstr(selected_id, sizeof(selected_id), s_chat_refresh_selected_id);
    }
    s_chat_refresh_selected_id[0] = '\0';
    if (!selected_id[0] && s_selected_chat >= 0 && s_selected_chat < s_chat_count) {
      copy_cstr(selected_id, sizeof(selected_id), s_chats[s_selected_chat].id);
    }
    s_bridge_ready = true;
    s_chats_loading = false;
    s_loading_error = false;
    int visible_count = PG_MAX(0, PG_MIN(count, MAX_CHATS));
    for (int i = visible_count; i < s_chat_count; i++) {
      clear_chat_slot(&s_chats[i]);
    }
    if (s_chat_count > visible_count) {
      s_chat_count = visible_count;
    }
    int preserved_index = find_chat_index_by_id(selected_id);
    if (preserved_index >= 0) {
      s_selected_chat = preserved_index;
      copy_cstr(s_chat_list_selected_id, sizeof(s_chat_list_selected_id), s_chats[s_selected_chat].id);
    } else if (s_selected_chat >= s_chat_count) {
      s_selected_chat = s_chat_count > 0 ? s_chat_count - 1 : 0;
    }
    if (s_chat_menu) {
      menu_layer_reload_data(s_chat_menu);
      select_chat_row(s_selected_chat, false);
    }
    show_status("Pebblegram");
    return;
  }

  if (strcmp(type, "messages_start") == 0) {
    int transfer_id = tuple_int(iter, MESSAGE_KEY_ImageTransferId, 0);
    int mode = tuple_int(iter, MESSAGE_KEY_Index, MESSAGE_MODE_INITIAL);
    bool initial = mode == MESSAGE_MODE_INITIAL;
    bool requested_page = s_loading_older_messages || s_loading_newer_messages;
    if (initial && s_view_state != ViewStateChat && !s_loading_messages) {
      return;
    }
    s_message_transfer_id = transfer_id;
    s_expected_rows = count;
    s_message_stream_mode = mode;
    char *stream_flag = tuple_cstring(iter, MESSAGE_KEY_Text);
    s_message_stream_silent = stream_flag && strcmp(stream_flag, "silent") == 0;
    IMAGE_DIAG("PGIMG watch messages_start mode=%d count=%d transfer=%d initial=%d silent=%d",
               mode, count, transfer_id, initial ? 1 : 0, s_message_stream_silent ? 1 : 0);
    if (initial) {
      clear_message_stage();
      clear_message_rows();
      s_loading_older_messages = false;
      s_loading_newer_messages = false;
      s_older_anchor_id[0] = '\0';
      s_newer_anchor_id[0] = '\0';
      s_at_newest = true;
      s_at_oldest = false;
    } else if (requested_page && !prepare_message_stage()) {
      reset_message_stream_state();
      s_loading_older_messages = false;
      s_loading_newer_messages = false;
      show_status("Memory low");
      return;
    }
    if (initial && !s_message_stream_silent && s_messages_root) {
      layer_mark_dirty(s_messages_root);
    }
    return;
  }

  if (strcmp(type, "message_prepend") == 0) {
    char anchor_id[MAX_ID];
    int anchor_y = 0;
    Message *slot;
    if (!message_transfer_matches(iter)) {
      return;
    }
    if (s_view_state != ViewStateChat || !s_messages_root) {
      return;
    }
    anchor_id[0] = '\0';
    recalc_message_layout();
    if (!s_message_stream_silent && s_loading_older_messages && s_older_anchor_id[0]) {
      copy_cstr(anchor_id, sizeof(anchor_id), s_older_anchor_id);
      int anchor_index = find_message_index_by_id(s_older_anchor_id);
      if (anchor_index >= 0) {
        anchor_y = s_message_y[anchor_index];
      }
    } else if (has_selected_message()) {
      copy_cstr(anchor_id, sizeof(anchor_id), s_messages[s_selected_message].id);
      anchor_y = s_message_y[s_selected_message];
    }
    slot = prepend_message_slot();
    populate_message_from_tuple(slot, iter);
    s_expected_rows = count;
    render_after_stream_prepend(anchor_id, anchor_y);
    return;
  }

  if (strcmp(type, "message_append") == 0) {
    char anchor_id[MAX_ID];
    int anchor_y = 0;
    Message *slot;
    bool follow_bottom;
    if (!message_transfer_matches(iter)) {
      return;
    }
    if (s_view_state != ViewStateChat || !s_messages_root) {
      return;
    }
    anchor_id[0] = '\0';
    recalc_message_layout();
    follow_bottom = s_at_newest && compose_target_is_selected();
    if (!s_message_stream_silent && s_loading_newer_messages && s_newer_anchor_id[0]) {
      copy_cstr(anchor_id, sizeof(anchor_id), s_newer_anchor_id);
      int anchor_index = find_message_index_by_id(s_newer_anchor_id);
      if (anchor_index >= 0) {
        anchor_y = s_message_y[anchor_index];
      }
    } else if (has_selected_message()) {
      copy_cstr(anchor_id, sizeof(anchor_id), s_messages[s_selected_message].id);
      anchor_y = s_message_y[s_selected_message];
    }
    char *incoming_text = tuple_cstring(iter, MESSAGE_KEY_Text);
    int pending_index = find_message_index_by_id("pending");
    bool replaces_pending = pending_index >= 0 &&
                            tuple_int(iter, MESSAGE_KEY_IsOutgoing, 0) != 0 &&
                            incoming_text &&
                            text_matches_ignoring_trailing_space(incoming_text,
                                                                 s_messages[pending_index].text);
    if (replaces_pending) {
      // Swap the optimistic bubble for the real message, keeping it in place.
      clear_message_slot(&s_messages[pending_index]);
      memset(&s_messages[pending_index], 0, sizeof(Message));
      init_message_strings(&s_messages[pending_index]);
      slot = &s_messages[pending_index];
    } else {
      slot = append_message_slot();
    }
    populate_message_from_tuple(slot, iter);
    if (replaces_pending) {
      s_touch_keyboard_sent_text[0] = '\0';
    }
    s_expected_rows = count;
    if (!s_message_stream_silent && follow_bottom) {
      scroll_to_bottom(false);
      return;
    }
    render_after_stream_append(anchor_id, anchor_y);
    return;
  }

  if (strcmp(type, "message_update") == 0) {
    char selected_id[MAX_ID];
    char *incoming_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
    int update_index;
    int selected_y = 0;
    int updated_selected_y = 0;
    if (!incoming_id || s_view_state != ViewStateChat || !s_messages_root) {
      return;
    }
    update_index = find_message_index_by_id(incoming_id);
    if (update_index < 0) {
      return;
    }
    selected_id[0] = '\0';
    if (has_selected_message()) {
      recalc_message_layout();
      copy_cstr(selected_id, sizeof(selected_id), s_messages[s_selected_message].id);
      selected_y = s_message_y[s_selected_message];
    }
    populate_message_from_tuple(&s_messages[update_index], iter);
    if (selected_id[0]) {
      int selected_index = find_message_index_by_id(selected_id);
      if (selected_index >= 0) {
        s_selected_message = selected_index;
        recalc_message_layout();
        updated_selected_y = s_message_y[selected_index];
        set_chat_scroll_offset(s_chat_scroll_offset + (updated_selected_y - selected_y), false);
      } else {
        recalc_message_layout();
      }
    } else {
      recalc_message_layout();
    }
    layer_mark_dirty(s_messages_root);
    request_next_image();
    return;
  }

  if (strcmp(type, "messages_done") == 0) {
    if (!message_transfer_matches(iter)) {
      return;
    }
    cancel_message_timeout();
    cancel_message_retry();
    char selected_id[MAX_ID];
    bool loading_initial = s_loading_messages;
    bool loading_older = s_loading_older_messages;
    bool loading_newer = s_loading_newer_messages;
    char *done_flag = tuple_cstring(iter, MESSAGE_KEY_Text);
    bool loading_silent = s_message_stream_silent || (done_flag && strcmp(done_flag, "silent") == 0);
    bool show_pending = s_chat_view_pending;
    bool chat_visible = s_view_state == ViewStateChat && s_messages_root;
    s_loading_messages = false;
    s_message_transfer_id = 0;
    selected_id[0] = '\0';

    if (loading_older && count == 0) {
      s_loading_older_messages = false;
      s_older_anchor_id[0] = '\0';
      s_older_anchor_y = 0;
      s_at_oldest = true;
      clear_message_stage();
      reset_message_stream_state();
      if (!loading_silent) {
        show_status("No older messages");
        if (s_messages_root) {
          layer_mark_dirty(s_messages_root);
        }
      }
      return;
    }

    if (loading_newer && count == 0) {
      s_loading_newer_messages = false;
      s_newer_anchor_id[0] = '\0';
      s_newer_anchor_y = 0;
      s_at_newest = true;
      clear_message_stage();
      reset_message_stream_state();
      if (!loading_silent) {
        show_status(s_current_chat_title);
        if (s_messages_root) {
          layer_mark_dirty(s_messages_root);
        }
      }
      return;
    }

    char fallback_id[MAX_ID];
    bool staged_load = loading_older || loading_newer;
    bool live_anchor = false;
    int live_anchor_y = 0;
    int live_anchor_scroll_offset = s_chat_scroll_offset;
    fallback_id[0] = '\0';

    if (chat_visible && staged_load && has_selected_message()) {
      recalc_message_layout();
      copy_cstr(selected_id, sizeof(selected_id), s_messages[s_selected_message].id);
      live_anchor_y = s_message_y[s_selected_message];
      live_anchor_scroll_offset = s_chat_scroll_offset;
      live_anchor = true;
    }

    if (loading_older) {
      s_at_newest = false;
      s_at_oldest = false;
      copy_cstr(fallback_id, sizeof(fallback_id), s_older_anchor_id);
    } else if (loading_newer) {
      s_at_oldest = false;
      copy_cstr(fallback_id, sizeof(fallback_id), s_newer_anchor_id);
    } else if (s_user_scrolled_messages && s_selected_message >= 0 && s_selected_message < s_message_count) {
      copy_cstr(selected_id, sizeof(selected_id), s_messages[s_selected_message].id);
    }

    bool reversed_load = staged_load &&
                         ((loading_older && s_message_scroll_direction > 0) ||
                          (loading_newer && s_message_scroll_direction < 0));
    if (reversed_load) {
      int current_direction = s_message_scroll_direction;
      s_loading_older_messages = false;
      s_loading_newer_messages = false;
      s_older_anchor_id[0] = '\0';
      s_newer_anchor_id[0] = '\0';
      clear_message_stage();
      reset_message_stream_state();
      if (chat_visible) {
        show_status(s_current_chat_title);
        layer_mark_dirty(s_messages_root);
      }
      if (current_direction > 0 && !s_at_newest) {
        request_newer_messages(true);
      } else if (current_direction < 0 && !s_at_oldest) {
        request_older_messages(true);
      }
      return;
    }

    if (staged_load && live_anchor && !message_stage_contains_id(selected_id)) {
      s_loading_older_messages = false;
      s_loading_newer_messages = false;
      s_older_anchor_id[0] = '\0';
      s_newer_anchor_id[0] = '\0';
      clear_message_stage();
      reset_message_stream_state();
      if (chat_visible) {
        show_status(s_current_chat_title);
        layer_mark_dirty(s_messages_root);
      }
      if (loading_older && !s_at_oldest) {
        request_older_messages(true);
      } else if (loading_newer && !s_at_newest) {
        request_newer_messages(true);
      }
      return;
    }

    if (staged_load && !live_anchor && fallback_id[0]) {
      copy_cstr(selected_id, sizeof(selected_id), fallback_id);
    }

    if (staged_load && s_message_stage) {
      commit_message_stage(count);
    } else if (s_message_count > count) {
      s_message_count = count;
    }
    IMAGE_DIAG("PGIMG watch messages_done count=%d staged=%d visible=%d selected=%d rows=%d",
               count, staged_load ? 1 : 0, chat_visible ? 1 : 0,
               s_selected_message, s_message_count);
    if (!staged_load) {
      clear_message_stage();
    }
    int preserved_index = find_message_index_by_id(selected_id);
    if (preserved_index < 0 && staged_load && fallback_id[0]) {
      copy_cstr(selected_id, sizeof(selected_id), fallback_id);
      preserved_index = find_message_index_by_id(selected_id);
    }
    if (preserved_index >= 0) {
      s_selected_message = preserved_index;
    } else if (!s_user_scrolled_messages && !staged_load) {
      s_selected_message = s_at_newest ? s_message_count : (s_message_count > 0 ? s_message_count - 1 : -1);
    } else if (s_message_count > 0 && s_selected_message >= s_message_count) {
      s_selected_message = s_message_count - 1;
    } else if (s_message_count <= 0) {
      s_selected_message = -1;
    }
    s_loading_older_messages = false;
    s_loading_newer_messages = false;
    s_older_anchor_id[0] = '\0';
    s_newer_anchor_id[0] = '\0';
    reset_message_stream_state();
    s_expected_rows = count;
    if (!loading_older && !loading_newer && s_selected_chat >= 0 && s_selected_chat < s_chat_count) {
      s_chats[s_selected_chat].unread = false;
      s_chats[s_selected_chat].unread_count = 0;
    }

    if (chat_visible) {
      recalc_message_layout();
      if (staged_load && preserved_index >= 0) {
        GRect bounds = layer_get_bounds(s_messages_root);
        int margin = 6;
        if (loading_older && !loading_silent && preserved_index > 0) {
          s_selected_message = preserved_index - 1;
          set_chat_scroll_offset(s_message_y[s_selected_message] - margin, false);
          show_status(s_current_chat_title);
          layer_mark_dirty(s_messages_root);
          s_older_anchor_y = 0;
          s_newer_anchor_y = 0;
          request_next_image();
          return;
        }
        bool selected_is_tall = s_message_h[preserved_index] > bounds.size.h - (margin * 2);
        bool anchor_top = s_message_scroll_direction < 0 ||
                          (s_message_scroll_direction == 0 && loading_older);
        int target = (selected_is_tall && live_anchor) ?
                     live_anchor_scroll_offset + (s_message_y[preserved_index] - live_anchor_y) :
                     (anchor_top ?
                      s_message_y[preserved_index] - margin :
                      s_message_y[preserved_index] + s_message_h[preserved_index] + margin - bounds.size.h);
        set_chat_scroll_offset(target, false);
      }
      if (!has_selected_message() && !loading_silent) {
        scroll_to_bottom(false);
      }
      show_status(s_current_chat_title);
      layer_mark_dirty(s_messages_root);
      s_older_anchor_y = 0;
      s_newer_anchor_y = 0;
      request_next_image();
      return;
    }

    s_older_anchor_y = 0;
    s_newer_anchor_y = 0;
    if (!show_pending && loading_initial) {
      s_chat_view_pending = true;
      app_timer_register(1, show_chat_view_timer, NULL);
    }
    return;
  }

  if (strcmp(type, "chat") == 0 && index >= 0 && index < MAX_CHATS) {
    if (index == 0) {
      s_chat_refresh_selected_id[0] = '\0';
      if (s_chat_menu && s_view_state == ViewStateChatList) {
        MenuIndex selected = menu_layer_get_selected_index(s_chat_menu);
        s_selected_chat = selected.row;
        if (s_selected_chat >= 0 && s_selected_chat < s_chat_count) {
          copy_cstr(s_chat_list_selected_id, sizeof(s_chat_list_selected_id),
                    s_chats[s_selected_chat].id);
        }
      }
      if (s_chat_list_selected_id[0]) {
        copy_cstr(s_chat_refresh_selected_id, sizeof(s_chat_refresh_selected_id),
                  s_chat_list_selected_id);
      } else if (s_selected_chat >= 0 && s_selected_chat < s_chat_count) {
        copy_cstr(s_chat_refresh_selected_id, sizeof(s_chat_refresh_selected_id),
                  s_chats[s_selected_chat].id);
      }
    }
    Chat *chat = &s_chats[index];
    char *incoming_id = tuple_cstring(iter, MESSAGE_KEY_ChatId);
    if (incoming_id && strcmp(chat->id, incoming_id) != 0) {
      preserve_chat_avatar(chat, incoming_id);
    }
    copy_cstr(chat->id, sizeof(chat->id), incoming_id);
    set_chat_strings(chat,
                     tuple_cstring(iter, MESSAGE_KEY_Sender),
                     tuple_cstring(iter, MESSAGE_KEY_Text));
    chat->unread = tuple_int(iter, MESSAGE_KEY_IsUnread, 0) != 0;
    chat->unread_count = tuple_int(iter, MESSAGE_KEY_UnreadCount, chat->unread ? 1 : 0);
    bool list_grew = index + 1 > s_chat_count;
    if (list_grew) {
      s_chat_count = index + 1;
    }
    s_bridge_ready = true;
    s_loading_error = false;
    if (list_grew) {
      reveal_available_chat_rows();
    }
    if (s_chat_count >= s_expected_rows) {
      show_status("Pebblegram");
    }
    return;
  }

  if (strcmp(type, "message") == 0 && index >= 0 && index < MAX_MESSAGES) {
    cancel_message_timeout();
    cancel_message_retry();
    bool stream_initial = s_message_stream_mode == MESSAGE_MODE_INITIAL;
    Message *message = stream_initial || !s_message_stage ? &s_messages[index] : &s_message_stage[index];
    populate_message_from_tuple(message, iter);
    if (index + 1 > s_message_stage_count && !stream_initial && s_message_stage) {
      s_message_stage_count = index + 1;
    }
    if (index + 1 > s_message_count && stream_initial) {
      s_message_count = index + 1;
    }
    if (stream_initial && !s_message_stream_silent && s_view_state == ViewStateChat && s_messages_root) {
      render_messages();
      layer_mark_dirty(s_messages_root);
    }
    int loaded_count = stream_initial ? s_message_count : s_message_stage_count;
    if (loaded_count < s_expected_rows &&
        (s_loading_messages || s_loading_older_messages || s_loading_newer_messages)) {
      schedule_message_timeout();
    }
    if (loaded_count >= s_expected_rows) {
      if (stream_initial) {
        if (!s_user_scrolled_messages) {
          s_selected_message = s_at_newest ? s_message_count : (s_message_count > 0 ? s_message_count - 1 : -1);
        } else if (s_selected_message < 0 || s_selected_message >= s_message_count) {
          s_selected_message = s_message_count > 0 ? s_message_count - 1 : s_message_count;
        }
        request_next_image();
      }
      if (stream_initial && s_loading_messages && s_view_state != ViewStateChat && !s_chat_view_pending) {
        s_chat_view_pending = true;
        app_timer_register(1, show_chat_view_timer, NULL);
      }
    }
    return;
  }

  if (strcmp(type, "avatar_start") == 0) {
    char *chat_id = tuple_cstring(iter, MESSAGE_KEY_ChatId);
    int image_size = tuple_int(iter, MESSAGE_KEY_ImageSize, 0);
    int transfer_id = tuple_int(iter, MESSAGE_KEY_ImageTransferId, 0);
    if (!chat_id || find_chat_index_by_id(chat_id) < 0 || image_size <= 0 || image_size > MAX_AVATAR_BYTES) {
      reset_avatar_transfer_state();
      return;
    }
    if (!ensure_avatar_transfer_buffer(image_size)) {
      reset_avatar_transfer_state();
      return;
    }
    copy_cstr(s_avatar_chat_id, sizeof(s_avatar_chat_id), chat_id);
    s_avatar_size = image_size;
    s_avatar_received = 0;
    s_avatar_expected_offset = 0;
    s_avatar_transfer_id = transfer_id;
    return;
  }

  if (strcmp(type, "avatar") == 0) {
    char *chat_id = tuple_cstring(iter, MESSAGE_KEY_ChatId);
    int offset = tuple_int(iter, MESSAGE_KEY_Index, -1);
    int transfer_id = tuple_int(iter, MESSAGE_KEY_ImageTransferId, 0);
    Tuple *data = dict_find(iter, MESSAGE_KEY_ImageData);
    int data_len = data ? data->length : 0;
    if (!chat_id || strcmp(chat_id, s_avatar_chat_id) != 0 || transfer_id != s_avatar_transfer_id || !data ||
        !s_avatar_buffer ||
        !transfer_chunk_fits(offset, data_len, s_avatar_expected_offset,
                             s_avatar_size, s_avatar_buffer_capacity)) {
      reset_avatar_transfer_state();
      return;
    }
    memcpy(s_avatar_buffer + offset, data->value->data, data_len);
    s_avatar_received = offset + data_len;
    s_avatar_expected_offset = s_avatar_received;
    return;
  }

  if (strcmp(type, "avatar_done") == 0) {
    char *chat_id = tuple_cstring(iter, MESSAGE_KEY_ChatId);
    int transfer_id = tuple_int(iter, MESSAGE_KEY_ImageTransferId, 0);
    int chat_index = find_chat_index_by_id(chat_id);
    if (chat_index >= 0 && chat_id && strcmp(chat_id, s_avatar_chat_id) == 0 &&
        transfer_id == s_avatar_transfer_id && s_avatar_received == s_avatar_size &&
        s_avatar_buffer) {
      Chat *chat = &s_chats[chat_index];
      destroy_chat_avatar(chat);
      chat->avatar_bitmap = gbitmap_create_from_png_data(s_avatar_buffer, s_avatar_size);
      if (s_chat_menu) {
        layer_mark_dirty(menu_layer_get_layer(s_chat_menu));
      }
    }
    if (chat_id && strcmp(chat_id, s_avatar_chat_id) == 0) {
      reset_avatar_transfer_state();
    }
    return;
  }

	  if (strcmp(type, "image_start") == 0) {
	    char *message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
	    int image_size = tuple_int(iter, MESSAGE_KEY_ImageSize, 0);
	    int transfer_id = tuple_int(iter, MESSAGE_KEY_ImageTransferId, 0);
    int image_width = tuple_int(iter, MESSAGE_KEY_ImageWidth, 0);
    int image_height = tuple_int(iter, MESSAGE_KEY_ImageHeight, 0);
    char *image_format = tuple_cstring(iter, MESSAGE_KEY_Text);
    Message *message = find_message_by_image_token(message_id);
    bool is_active_image = message_id && strcmp(message_id, s_image_message_id) == 0;
    IMAGE_DIAG("PGIMG watch image_start msg=%s active=%d transfer=%d bytes=%d dims=%dx%d fmt=%s heap=%u",
               message_id ? message_id : "(null)", is_active_image ? 1 : 0,
               transfer_id, image_size, image_width, image_height,
               image_format && image_format[0] ? image_format : "png",
               image_diag_heap_free());
    if (!message || !is_active_image) {
      request_next_image();
      return;
    }
    int image_index = message_index_from_ptr(message);
    if (!message_id || transfer_id <= 0 || image_size <= 0 || image_size > MAX_IMAGE_BYTES) {
      bool retrying_image = image_size > MAX_IMAGE_BYTES &&
                             retry_active_image_request(message, "Resizing");
      IMAGE_DIAG("PGIMG watch image_start rejected msg=%s size=%d retry=%d",
                 message_id ? message_id : "(null)", image_size, retrying_image ? 1 : 0);
      if (!retrying_image) {
        message->image_requested = false;
        message->image_failed = true;
        set_message_image_error(message, image_size > MAX_IMAGE_BYTES ? "Photo too large" : "Photo start failed");
      }
      if (s_messages_root) {
        layer_mark_dirty(s_messages_root);
      }
      if (!retrying_image && message_id && strcmp(message_id, s_image_message_id) == 0) {
        reset_image_transfer_state();
      }
      if (!retrying_image) {
        request_next_image();
      }
      return;
    }
  if (image_width > 0 && image_height > 0 &&
        image_width <= IMAGE_DECODE_MAX_DIMENSION && image_height <= IMAGE_DECODE_MAX_DIMENSION) {
      bool dimensions_changed = message->image_width != image_width || message->image_height != image_height;
      bool selected_image = image_index == s_selected_message;
      message->image_width = (uint16_t)image_width;
      message->image_height = (uint16_t)image_height;
      if (dimensions_changed) {
        recalc_message_layout();
        if (selected_image && s_messages_root) {
          GRect bounds = layer_get_bounds(s_messages_root);
          int margin = 6;
          if (message_image_scrolls_tall(image_index, bounds, margin)) {
            bool align_top = s_message_scroll_direction >= 0;
            set_chat_scroll_offset_quiet(message_image_edge_scroll_target(image_index, bounds, margin, align_top));
          }
        }
      }
    }
	    if (image_index == s_selected_message || message_needs_decode_headroom(message, image_size)) {
	      destroy_other_message_images(message);
	    }
    reset_avatar_transfer_state();
    free_full_text_body();
    if (!ensure_image_transfer_buffer(image_size)) {
      destroy_other_message_images(message);
    }
    if (!ensure_image_transfer_buffer(image_size)) {
      bool retrying_image = retry_active_image_request(message, "Resizing");
      IMAGE_DIAG("PGIMG watch image_start buffer_fail msg=%s size=%d retry=%d heap=%u",
                 message_id ? message_id : "(null)", image_size, retrying_image ? 1 : 0,
                 image_diag_heap_free());
      if (!retrying_image) {
        message->image_requested = false;
        message->image_failed = true;
        set_message_image_error(message, "Photo too large");
        reset_image_transfer_state();
      }
      if (s_messages_root) {
        layer_mark_dirty(s_messages_root);
      }
      if (!retrying_image) {
        request_next_image();
      }
      return;
    }
    copy_cstr(s_image_message_id, sizeof(s_image_message_id), message_id);
    s_image_size = image_size;
	    s_image_received = 0;
	    s_image_expected_offset = 0;
	    s_image_transfer_id = transfer_id;
    s_image_is_pbi = image_format && strcmp(image_format, "pbi") == 0;
	    copy_cstr(message->image_error, sizeof(message->image_error), "Receiving");
	    set_message_image_progress(message, 25);
	    schedule_image_transfer_timeout();
	    if (s_messages_root) {
	      layer_mark_dirty(s_messages_root);
	    }
	    return;
	  }

	  if (strcmp(type, "image_status") == 0) {
	    char *message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
	    char *detail = tuple_cstring(iter, MESSAGE_KEY_Error);
	    Message *message = find_message_by_image_token(message_id);
	    bool is_active_image = message_id && strcmp(message_id, s_image_message_id) == 0;
    IMAGE_DIAG("PGIMG watch image_status msg=%s active=%d detail=%s",
               message_id ? message_id : "(null)", is_active_image ? 1 : 0,
               detail && detail[0] ? detail : "");
	    if (message && is_active_image && message->image_requested && !message->image_failed) {
	      copy_cstr(message->image_error, sizeof(message->image_error), detail && detail[0] ? detail : "Preparing");
	      set_message_image_progress(message, image_loading_phase_percent(message->image_error));
      if (!s_image_buffer) {
        schedule_image_prepare_timeout();
      }
	      if (s_messages_root) {
	        layer_mark_dirty(s_messages_root);
	      }
	    }
	    return;
	  }

	  if (strcmp(type, "image") == 0) {
    char *message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
    int offset = tuple_int(iter, MESSAGE_KEY_Index, -1);
    int transfer_id = tuple_int(iter, MESSAGE_KEY_ImageTransferId, 0);
    Tuple *data = dict_find(iter, MESSAGE_KEY_ImageData);
    int data_len = data ? data->length : 0;
    if (!message_id || strcmp(message_id, s_image_message_id) != 0 ||
        transfer_id != s_image_transfer_id || !data) {
      return;
    }
    if (!s_image_buffer ||
        !transfer_chunk_fits(offset, data_len, s_image_expected_offset,
                             s_image_size, s_image_buffer_capacity)) {
      APP_LOG(APP_LOG_LEVEL_WARNING, "Image transfer gap for %s at %d expected %d",
              message_id, offset, s_image_expected_offset);
      Message *message = find_message_by_image_token(message_id);
      if (message) {
        message->image_requested = false;
        message->image_failed = true;
        set_message_image_error(message, "Photo transfer gap");
      }
      clear_active_image_request();
      if (s_messages_root) {
        layer_mark_dirty(s_messages_root);
      }
      request_next_image();
      return;
    }
    memcpy(s_image_buffer + offset, data->value->data, data_len);
    s_image_received = offset + data_len;
    s_image_expected_offset = s_image_received;
    Message *message = find_message_by_image_token(message_id);
    if (message) {
      set_message_image_progress(message, 25 + ((progress_percent(s_image_received, s_image_size) * 75) / 100));
    }
    if (offset == 0 || s_image_received == s_image_size) {
      IMAGE_DIAG("PGIMG watch image_chunk msg=%s transfer=%d offset=%d len=%d received=%d/%d",
                 message_id ? message_id : "(null)", transfer_id, offset, data_len,
                 s_image_received, s_image_size);
    }
    schedule_image_transfer_timeout();
    if (s_messages_root) {
      layer_mark_dirty(s_messages_root);
    }
    return;
  }

  if (strcmp(type, "image_done") == 0) {
    char *message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
    int transfer_id = tuple_int(iter, MESSAGE_KEY_ImageTransferId, 0);
    Message *message = find_message_by_image_token(message_id);
    int image_index = message_index_from_ptr(message);
    bool transfer_complete = s_image_received == s_image_size && s_image_buffer;
    bool should_keep_image = message_image_near_viewport(image_index, IMAGE_KEEP_SCREEN_MARGIN);
    bool is_active_image = message_id && strcmp(message_id, s_image_message_id) == 0 &&
                           transfer_id == s_image_transfer_id;
    bool retrying_image = false;
    IMAGE_DIAG("PGIMG watch image_done msg=%s active=%d transfer=%d complete=%d received=%d/%d pbi=%d keep=%d heap=%u",
               message_id ? message_id : "(null)", is_active_image ? 1 : 0, transfer_id,
               transfer_complete ? 1 : 0, s_image_received, s_image_size,
               s_image_is_pbi ? 1 : 0, should_keep_image ? 1 : 0,
               image_diag_heap_free());
    if (message && is_active_image) {
      if (transfer_complete) {
        bool attempted_decode = false;
        destroy_message_bitmap(message);
        destroy_other_message_images(message);
        reset_avatar_transfer_state();
        free_full_text_body();
        if (s_image_is_pbi) {
          attempted_decode = true;
          message->image_bitmap = gbitmap_create_with_data(s_image_buffer);
          if (message->image_bitmap) {
            message->image_data = s_image_buffer;
            s_image_buffer = NULL;
            s_image_buffer_capacity = 0;
          }
        } else if (message_image_decode_has_headroom(message)) {
          attempted_decode = true;
          message->image_bitmap = gbitmap_create_from_png_data(s_image_buffer, s_image_size);
        }
        if (!s_image_is_pbi && !message->image_bitmap && s_loaded_image_count > 0) {
          destroy_other_message_images(message);
          message->image_bitmap = gbitmap_create_from_png_data(s_image_buffer, s_image_size);
        }
        if (message->image_bitmap) {
          message->image_failed = false;
          message->image_error[0] = '\0';
          s_loaded_image_count++;
          sync_message_images();
          IMAGE_DIAG("PGIMG watch decode_success msg=%s pbi=%d loaded=%d heap=%u",
                     message_id ? message_id : "(null)", s_image_is_pbi ? 1 : 0,
                     s_loaded_image_count, image_diag_heap_free());
        } else {
          retrying_image = retry_active_image_request(message, "Resizing");
          IMAGE_DIAG("PGIMG watch decode_fail msg=%s attempted=%d retry=%d heap=%u",
                     message_id ? message_id : "(null)", attempted_decode ? 1 : 0,
                     retrying_image ? 1 : 0, image_diag_heap_free());
          if (!retrying_image) {
            message->image_failed = true;
            set_message_image_error(message, attempted_decode ? "Photo decode failed" : "Photo too large");
          }
        }
      } else if (should_keep_image) {
        retrying_image = retry_active_image_request(message, "Retrying");
        IMAGE_DIAG("PGIMG watch incomplete msg=%s retry=%d",
                   message_id ? message_id : "(null)", retrying_image ? 1 : 0);
        if (!retrying_image) {
          message->image_failed = true;
          set_message_image_error(message, "Photo transfer incomplete");
        }
      } else {
        message->image_failed = false;
        message->image_error[0] = '\0';
        message->image_progress = 0;
      }
      if (!retrying_image) {
        message->image_requested = false;
      }
      if (s_messages_root) {
        layer_mark_dirty(s_messages_root);
      }
    }
    if (is_active_image && !retrying_image) {
      if (s_image_retry_timer) {
        app_timer_cancel(s_image_retry_timer);
        s_image_retry_timer = NULL;
      }
      reset_image_transfer_state();
    }
    if (!retrying_image) {
      request_next_image();
    }
    return;
  }

	  if (strcmp(type, "image_error") == 0) {
    char *message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
    char *detail = tuple_cstring(iter, MESSAGE_KEY_Error);
    int transfer_id = tuple_int(iter, MESSAGE_KEY_ImageTransferId, s_image_transfer_id);
    Message *message = find_message_by_image_token(message_id);
    int image_index = message_index_from_ptr(message);
    bool is_active_image = message_id && strcmp(message_id, s_image_message_id) == 0 &&
                           transfer_id == s_image_transfer_id;
    IMAGE_DIAG("PGIMG watch image_error msg=%s active=%d transfer=%d detail=%s",
               message_id ? message_id : "(null)", is_active_image ? 1 : 0,
               transfer_id, detail && detail[0] ? detail : "");
    if (message && is_active_image) {
      message->image_requested = false;
      message->image_failed = message_image_near_viewport(image_index, IMAGE_KEEP_SCREEN_MARGIN);
      if (message->image_failed) {
        set_message_image_error(message, detail && detail[0] ? detail : "Photo prepare failed");
      } else {
        message->image_error[0] = '\0';
        message->image_progress = 0;
      }
    }
    if (is_active_image) {
      if (s_image_retry_timer) {
        app_timer_cancel(s_image_retry_timer);
        s_image_retry_timer = NULL;
      }
      reset_image_transfer_state();
    }
    if (s_messages_root) {
      layer_mark_dirty(s_messages_root);
    }
    request_next_image();
    return;
  }

  if (strcmp(type, "reacted") == 0) {
    show_status("Reacted");
  }

  if (strcmp(type, "sent") == 0) {
    touch_keyboard_send_result(true);
    show_status("Sent");
    return;
  }

  if (strcmp(type, "edited") == 0) {
    show_status("Edited");
    return;
  }

  if (strcmp(type, "deleted") == 0) {
    char *deleted_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
    int deleted_index = find_message_index_by_id(deleted_id);
    if (deleted_index >= 0) {
      remove_message_at(deleted_index);
    }
    show_status("Deleted");
    return;
  }

  if (strcmp(type, "message_context") == 0) {
    char *incoming_message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
    if (!has_selected_message() || !incoming_message_id ||
        strcmp(s_messages[s_selected_message].id, incoming_message_id) != 0) {
      return;
    }
    copy_cstr(s_full_text_title, sizeof(s_full_text_title), tuple_cstring(iter, MESSAGE_KEY_Sender));
    if (s_full_text_body) {
      copy_cstr(s_full_text_body, MAX_FULL_TEXT, tuple_cstring(iter, MESSAGE_KEY_Text));
    }
    if (s_action_mode == ActionMenuFullText && s_full_text_context && s_action_layer) {
      s_full_text_scroll_offset = 0;
      layer_mark_dirty(s_action_layer);
    }
    return;
  }

  if (strcmp(type, "chat_action_done") == 0) {
    char *action = tuple_cstring(iter, MESSAGE_KEY_Text);
    char *chat_id = tuple_cstring(iter, MESSAGE_KEY_ChatId);
    int chat_index = find_chat_index_by_id(chat_id);
    if (action && (strcmp(action, "archiveChat") == 0 || strcmp(action, "deleteChat") == 0)) {
      remove_chat_at(chat_index >= 0 ? chat_index : s_selected_chat);
      show_status(strcmp(action, "archiveChat") == 0 ? "Archived" : "Deleted");
    } else if (action && strcmp(action, "muteChat") == 0) {
      show_status("Muted");
    } else if (action && strcmp(action, "markUnread") == 0) {
      if (chat_index >= 0) {
        s_chats[chat_index].unread = true;
        s_chats[chat_index].unread_count = 0;
        if (s_chat_menu) {
          menu_layer_reload_data(s_chat_menu);
          select_chat_row(s_selected_chat, false);
        }
      }
      show_status("Marked unread");
    } else {
      show_status("Done");
    }
  }
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  show_status("Message dropped");
}

static void outbox_failed_callback(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  char *command = tuple_cstring(iter, MESSAGE_KEY_Command);
  if (command && strcmp(command, "get_image") == 0) {
    char *message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
    Message *message = find_message_by_image_token(tuple_cstring(iter, MESSAGE_KEY_MessageId));
    if (message) {
      message->image_requested = true;
    }
    if (message_id && strcmp(message_id, s_image_message_id) == 0) {
      free_image_transfer_buffer();
      s_image_size = 0;
      s_image_received = 0;
      s_image_expected_offset = 0;
      s_image_transfer_id = 0;
    }
    schedule_image_retry();
    if (s_messages_root) {
      layer_mark_dirty(s_messages_root);
    }
    return;
  }
  show_status("Send failed");
}

static void close_action_window(void) {
  if (s_native_action_menu) {
    action_menu_close(s_native_action_menu, true);
    return;
  }
  if (s_action_window) {
    window_stack_remove(s_action_window, true);
    s_action_window = NULL;
  }
}

static int action_item_count(void) {
  switch (s_action_mode) {
    case ActionMenuMain:
      if (!has_selected_message()) {
        return 4 + (touch_keyboard_supported() ? 1 : 0);
      }
      return 4 +
             (s_messages[s_selected_message].outgoing ? (touch_keyboard_supported() ? 2 : 1) : 0) +
             (selected_message_has_context() ? 1 : 0) +
             (selected_message_is_truncated() ? 1 : 0);
    case ActionMenuChat:
      return 5;
    case ActionMenuCanned:
      return canned_reply_count();
    case ActionMenuConfirm:
      return 2;
    case ActionMenuReply:
      return 3 + (touch_keyboard_supported() ? 1 : 0);
    case ActionMenuReactionGrid:
      return reaction_grid_count();
    case ActionMenuEmojiReplyGrid:
      return emoji_reply_count();
    case ActionMenuFullText:
      return 0;
  }
  return 0;
}

static void native_action_perform(ActionMenu *action_menu, const ActionMenuItem *action,
                                  void *context);

#define NATIVE_ACTION_INDEX_NONE 0xffff

static void full_text_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, ACTION_BG);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  int rail_w = ROUND_UI ? 0 : 18;
  int content_x = ROUND_UI ? 28 : 24;
  int content_w = bounds.size.w - content_x - (ROUND_UI ? 24 : 0);
  graphics_context_set_fill_color(ctx, APP_COLOR);
  if (ROUND_UI) {
    graphics_fill_rect(ctx, GRect(0, 0, 12, bounds.size.h), 0, GCornerNone);
  } else {
    graphics_fill_rect(ctx, GRect(0, 0, rail_w, bounds.size.h), 0, GCornerNone);
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_circle(ctx, GPoint(rail_w / 2, 10), 2);
  }

  char title[MAX_SENDER + 10];
  const char *text = "";
  const char *heading = NULL;
  GFont full_font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  GFont heading_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  int text_w = content_w - 12;
  int heading_h = 0;

  title[0] = '\0';
  if (s_selected_message >= 0 && s_selected_message < s_message_count) {
    if (s_full_text_context) {
      copy_cstr(title, sizeof(title), s_full_text_title);
      heading = title;
      text = s_full_text_body ? s_full_text_body : "";
    } else {
      text = s_messages[s_selected_message].text;
    }
  }

  if (heading && heading[0]) {
    GSize heading_size = graphics_text_layout_get_content_size(
      heading, heading_font, GRect(0, 0, text_w, 2000),
      GTextOverflowModeWordWrap, GTextAlignmentLeft
    );
    heading_h = heading_size.h + 4;
  }
  GSize text_size = graphics_text_layout_get_content_size(
    text, full_font, GRect(0, 0, text_w, 2000),
    GTextOverflowModeWordWrap, GTextAlignmentLeft
  );
  s_full_text_height = heading_h + text_size.h + 20;
  int max_scroll = PG_MAX(0, s_full_text_height - bounds.size.h + 8);
  s_full_text_scroll_offset = PG_MIN(s_full_text_scroll_offset, max_scroll);

  graphics_context_set_text_color(ctx, ACTION_TEXT_SELECTED);
  if (heading && heading[0]) {
    graphics_draw_text(ctx, heading, heading_font,
                       GRect(content_x + 6, 8 - s_full_text_scroll_offset, text_w, heading_h),
                       GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
  }
  graphics_draw_text(ctx, text, full_font,
                     GRect(content_x + 6, 8 + heading_h - s_full_text_scroll_offset,
                           text_w, text_size.h + 16),
                     GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
}

static void *native_action_data(ActionItem item, int index) {
  uintptr_t packed_index = index < 0 ? NATIVE_ACTION_INDEX_NONE : (uint16_t)index;
  uintptr_t packed = (((uintptr_t)item & 0xffff) << 16) | (packed_index & 0xffff);
  return (void *)packed;
}

static ActionItem native_action_data_item(void *data) {
  return (ActionItem)((((uintptr_t)data) >> 16) & 0xffff);
}

static int native_action_data_index(void *data) {
  uint16_t index = (uint16_t)(((uintptr_t)data) & 0xffff);
  return index == NATIVE_ACTION_INDEX_NONE ? -1 : (int)index;
}

static bool native_add_action(ActionMenuLevel *level, const char *label,
                              ActionItem item, int index) {
  return action_menu_level_add_action(level, label, native_action_perform,
                                      native_action_data(item, index)) != NULL;
}

static void native_add_child(ActionMenuLevel *parent, ActionMenuLevel *child,
                             const char *label) {
  if (!child) {
    return;
  }
  if (!action_menu_level_add_child(parent, child, label)) {
    action_menu_hierarchy_destroy(child, NULL, NULL);
  }
}

static void native_defer_action_mode(ActionMenuMode mode) {
  s_native_deferred_mode = mode;
  s_native_has_deferred_mode = true;
}

static ActionMenuLevel *native_create_canned_level(bool as_reply) {
  int count = canned_reply_count();
  ActionMenuLevel *level = action_menu_level_create((uint16_t)PG_MAX(1, count));
  if (!level) {
    return NULL;
  }
  if (count <= 0) {
    native_add_action(level, "No canned messages", ActionItemConfirmCancel, -1);
    return level;
  }
  for (int i = 0; i < count; i++) {
    native_add_action(level, s_canned[i][0] ? s_canned[i] : "Canned message",
                      as_reply ? ActionItemReplyCanned : ActionItemCanned, i);
  }
  return level;
}

static ActionMenuLevel *native_create_emoji_level(bool as_reply) {
  int count = emoji_reply_count();
  ActionMenuLevel *level = action_menu_level_create((uint16_t)PG_MAX(1, count));
  if (!level) {
    return NULL;
  }
  action_menu_level_set_display_mode(level, ActionMenuLevelDisplayModeThin);
  for (int i = 0; i < count; i++) {
    native_add_action(level, emoji_reply_glyph_at(i),
                      as_reply ? ActionItemReplyEmoji : ActionItemEmoji, i);
  }
  return level;
}

static ActionMenuLevel *native_create_reaction_level(void) {
  int count = reaction_grid_count();
  ActionMenuLevel *level = action_menu_level_create((uint16_t)PG_MAX(1, count));
  if (!level) {
    return NULL;
  }
  action_menu_level_set_display_mode(level, ActionMenuLevelDisplayModeThin);
  for (int i = 0; i < count; i++) {
    native_add_action(level, reaction_grid_glyph_at(i), ActionItemReact, i);
  }
  return level;
}

static ActionMenuLevel *native_create_reply_level(void) {
  ActionMenuLevel *level = action_menu_level_create(touch_keyboard_supported() ? 4 : 3);
  if (!level) {
    return NULL;
  }
  native_add_action(level, "Dictate Reply", ActionItemReplyDictate, -1);
  native_add_child(level, native_create_canned_level(true), "Canned Message");
  native_add_child(level, native_create_emoji_level(true), "Emoji");
  if (touch_keyboard_supported()) {
    native_add_action(level, "Type Reply", ActionItemReplyKeyboard, -1);
  }
  return level;
}

static ActionMenuLevel *native_build_main_level(void) {
  ActionMenuLevel *level = action_menu_level_create((uint16_t)PG_MAX(1, action_item_count()));
  if (!level) {
    return NULL;
  }

  if (!has_selected_message()) {
    native_add_action(level, "Voice", ActionItemCompose, -1);
    native_add_child(level, native_create_canned_level(false), "Canned Message");
    native_add_child(level, native_create_emoji_level(false), "Emoji");
    if (touch_keyboard_supported()) {
      native_add_action(level, "Keyboard", ActionItemKeyboard, -1);
    }
    native_add_action(level, "Go to Bottom", ActionItemGoToBottom, -1);
    return level;
  }

  native_add_child(level, native_create_reply_level(), "Reply");
  native_add_child(level, native_create_reaction_level(), "React");
  if (selected_message_has_context()) {
    native_add_action(level, selected_message_context_is_forward() ? "View Forward" : "View Quote",
                      ActionItemFullContext, -1);
  }
  if (s_messages[s_selected_message].outgoing) {
    if (touch_keyboard_supported()) {
      native_add_action(level, "Edit by Keyboard", ActionItemEditKeyboard, -1);
      native_add_action(level, "Edit by Voice", ActionItemEdit, -1);
    } else {
      native_add_action(level, "Edit Message", ActionItemEdit, -1);
    }
  }
  if (selected_message_is_truncated()) {
    native_add_action(level, "View Full Message", ActionItemFullText, -1);
  }
  native_add_action(level, "Delete Message", ActionItemDelete, -1);
  native_add_action(level, "Go to Bottom", ActionItemGoToBottom, -1);
  return level;
}

static ActionMenuLevel *native_build_chat_level(void) {
  ActionMenuLevel *level = action_menu_level_create(5);
  if (!level) {
    return NULL;
  }
  native_add_action(level, "Archive Chat", ActionItemArchiveChat, -1);
  native_add_action(level, "Delete Chat", ActionItemDeleteChat, -1);
  native_add_action(level, "Mute Chat", ActionItemMuteChat, -1);
  native_add_action(level, "Mark as Unread", ActionItemMarkUnread, -1);
  native_add_action(level, "Go Back", ActionItemGoBack, -1);
  return level;
}

static ActionMenuLevel *native_build_confirm_level(void) {
  ActionMenuLevel *level = action_menu_level_create(2);
  if (!level) {
    return NULL;
  }
  native_add_action(level, s_pending_chat_command[0] ? "Delete" : "Send",
                    ActionItemConfirmSend, -1);
  native_add_action(level, "Cancel", ActionItemConfirmCancel, -1);
  return level;
}

static ActionMenuLevel *native_build_action_level(ActionMenuMode mode) {
  switch (mode) {
    case ActionMenuMain:
      return native_build_main_level();
    case ActionMenuChat:
      return native_build_chat_level();
    case ActionMenuCanned:
      return native_create_canned_level(s_pending_send_as_reply);
    case ActionMenuConfirm:
      return native_build_confirm_level();
    case ActionMenuReply:
      return native_create_reply_level();
    case ActionMenuReactionGrid:
      return native_create_reaction_level();
    case ActionMenuEmojiReplyGrid:
      return native_create_emoji_level(s_pending_send_as_reply);
    case ActionMenuFullText:
      return NULL;
  }
  return NULL;
}

static void native_action_menu_did_close(ActionMenu *menu, const ActionMenuItem *performed_action,
                                         void *context) {
  ActionMenuLevel *root = s_native_action_root;
  int keyboard_mode = s_native_deferred_keyboard;
  s_native_deferred_keyboard = -1;
  bool start_dictation_after_close = s_native_deferred_dictation;
  bool show_next = s_native_has_deferred_mode;
  ActionMenuMode next_mode = s_native_deferred_mode;

  s_native_action_menu = NULL;
  s_native_action_root = NULL;
  s_native_deferred_dictation = false;
  s_native_has_deferred_mode = false;

  if (root) {
    action_menu_hierarchy_destroy(root, NULL, NULL);
  }

  if (keyboard_mode >= 0) {
    const char *target = s_native_deferred_keyboard_target[0] ? s_native_deferred_keyboard_target : NULL;
    int index = target ? find_message_index_by_id(target) : -1;
    const char *initial = (keyboard_mode == KeyboardModeEdit && index >= 0) ? s_messages[index].text : NULL;
    open_touch_keyboard((KeyboardMode)keyboard_mode, target, initial);
  } else if (start_dictation_after_close) {
    start_dictation();
  } else if (show_next) {
    show_action_window(next_mode);
  }
}

static bool show_native_action_menu(ActionMenuMode mode) {
  close_touch_keyboard();
  if (s_view_state == ViewStateChat) {
    show_status(s_current_chat_title);
  } else {
    show_status("Pebblegram");
  }

  if (s_native_action_menu) {
    action_menu_close(s_native_action_menu, false);
    return false;
  }

  s_action_mode = mode;
  s_action_selected = 0;
  s_native_action_root = native_build_action_level(mode);
  if (!s_native_action_root) {
    return false;
  }

  ActionMenuConfig config = {
    .root_level = s_native_action_root,
    .context = NULL,
    .colors = {
      .background = APP_COLOR,
      .foreground = GColorWhite
    },
    .will_close = NULL,
    .did_close = native_action_menu_did_close,
    .align = ActionMenuAlignCenter
  };
  s_native_action_menu = action_menu_open(&config);
  if (!s_native_action_menu) {
    action_menu_hierarchy_destroy(s_native_action_root, NULL, NULL);
    s_native_action_root = NULL;
    return false;
  }
  return true;
}

static void native_action_perform(ActionMenu *action_menu, const ActionMenuItem *action,
                                  void *context) {
  void *data = action_menu_item_get_action_data(action);
  ActionItem item = native_action_data_item(data);
  int index = native_action_data_index(data);

  switch (item) {
    case ActionItemKeyboard:
      s_native_deferred_keyboard = KeyboardModeCompose;
      s_native_deferred_keyboard_target[0] = '\0';
      break;
    case ActionItemReplyKeyboard:
      if (has_selected_message()) {
        s_native_deferred_keyboard = KeyboardModeReply;
        copy_cstr(s_native_deferred_keyboard_target, sizeof(s_native_deferred_keyboard_target),
                  s_messages[s_selected_message].id);
      }
      break;
    case ActionItemEditKeyboard:
      if (has_selected_message() && s_messages[s_selected_message].outgoing) {
        s_native_deferred_keyboard = KeyboardModeEdit;
        copy_cstr(s_native_deferred_keyboard_target, sizeof(s_native_deferred_keyboard_target),
                  s_messages[s_selected_message].id);
      }
      break;
    case ActionItemCompose:
      s_pending_edit_message_id[0] = '\0';
      s_pending_chat_command[0] = '\0';
      s_pending_send_as_reply = false;
      s_native_deferred_dictation = true;
      break;
    case ActionItemCanned:
    case ActionItemReplyCanned:
      if (index >= 0 && index < canned_reply_count()) {
        s_pending_edit_message_id[0] = '\0';
        s_pending_chat_command[0] = '\0';
        s_pending_send_as_reply = item == ActionItemReplyCanned;
        copy_cstr(s_pending_text, sizeof(s_pending_text), s_canned[index]);
        native_defer_action_mode(ActionMenuConfirm);
      }
      break;
    case ActionItemReply:
      native_defer_action_mode(ActionMenuReply);
      break;
    case ActionItemReplyDictate:
      s_pending_edit_message_id[0] = '\0';
      s_pending_chat_command[0] = '\0';
      s_pending_send_as_reply = true;
      s_native_deferred_dictation = true;
      break;
    case ActionItemReplyEmoji:
      if (index >= 0 && index < emoji_reply_count()) {
        send_text_message(emoji_reply_glyph_at(index), true);
        s_pending_send_as_reply = false;
      }
      break;
    case ActionItemEmoji:
      if (index >= 0 && index < emoji_reply_count()) {
        send_text_message(emoji_reply_glyph_at(index), false);
        s_pending_send_as_reply = false;
      }
      break;
    case ActionItemReact:
      if (index >= 0 && index < reaction_grid_count()) {
        send_selected_reaction(reaction_grid_token_at(index));
      }
      break;
    case ActionItemEdit:
      if (has_selected_message() && s_messages[s_selected_message].outgoing) {
        copy_cstr(s_pending_edit_message_id, sizeof(s_pending_edit_message_id),
                  s_messages[s_selected_message].id);
        s_pending_chat_command[0] = '\0';
        s_pending_send_as_reply = false;
        s_native_deferred_dictation = true;
      }
      break;
    case ActionItemDelete:
      delete_selected_message();
      break;
    case ActionItemFullText:
      s_full_text_context = true;
      if (!has_selected_message() || !ensure_full_text_body()) {
        show_status("Memory low");
        break;
      }
      s_full_text_title[0] = '\0';
      copy_cstr(s_full_text_body, MAX_FULL_TEXT, s_messages[s_selected_message].text);
      send_command_with_status("get_message_text", s_current_chat_id, NULL, NULL,
                               s_messages[s_selected_message].id, false);
      s_full_text_scroll_offset = 0;
      native_defer_action_mode(ActionMenuFullText);
      break;
    case ActionItemFullContext:
      s_full_text_context = true;
      if (!has_selected_message() || !ensure_full_text_body()) {
        show_status("Memory low");
        break;
      }
      char body[MAX_CONTEXT_TEXT];
      message_context_strings(&s_messages[s_selected_message], s_full_text_title,
                              sizeof(s_full_text_title), body, sizeof(body));
      copy_cstr(s_full_text_body, MAX_FULL_TEXT, body);
      send_command_with_status("get_context", s_current_chat_id, NULL, NULL,
                               s_messages[s_selected_message].id, false);
      s_full_text_scroll_offset = 0;
      native_defer_action_mode(ActionMenuFullText);
      break;
    case ActionItemGoToBottom:
      go_to_bottom();
      break;
    case ActionItemArchiveChat:
      send_selected_chat_action("archive_chat");
      break;
    case ActionItemDeleteChat:
      copy_cstr(s_pending_chat_command, sizeof(s_pending_chat_command), "delete_chat");
      if (s_selected_chat >= 0 && s_selected_chat < s_chat_count) {
        snprintf(s_pending_text, sizeof(s_pending_text), "Delete %s?",
                 s_chats[s_selected_chat].title);
      } else {
        copy_cstr(s_pending_text, sizeof(s_pending_text), "Delete chat?");
      }
      native_defer_action_mode(ActionMenuConfirm);
      break;
    case ActionItemMuteChat:
      send_selected_chat_action("mute_chat");
      break;
    case ActionItemMarkUnread:
      if (s_selected_chat >= 0 && s_selected_chat < s_chat_count) {
        s_chats[s_selected_chat].unread = true;
        s_chats[s_selected_chat].unread_count = 0;
        if (s_chat_menu) {
          menu_layer_reload_data(s_chat_menu);
          select_chat_row(s_selected_chat, false);
        }
      }
      send_selected_chat_action("mark_unread");
      break;
    case ActionItemConfirmSend:
      if (s_pending_chat_command[0]) {
        send_selected_chat_action(s_pending_chat_command);
        s_pending_chat_command[0] = '\0';
      } else if (s_pending_edit_message_id[0]) {
        edit_selected_message(s_pending_text);
      } else {
        send_text_message(s_pending_text, s_pending_send_as_reply);
      }
      s_pending_send_as_reply = false;
      break;
    case ActionItemConfirmCancel:
      s_pending_edit_message_id[0] = '\0';
      s_pending_chat_command[0] = '\0';
      s_pending_send_as_reply = false;
      break;
    case ActionItemGoBack:
      break;
  }
}

static void show_action_window(ActionMenuMode mode) {
  if (mode != ActionMenuFullText) {
    if (!show_native_action_menu(mode)) {
      show_status("Menu unavailable");
    }
    return;
  }

  close_touch_keyboard();
  if (s_view_state == ViewStateChat) {
    show_status(s_current_chat_title);
  } else {
    show_status("Pebblegram");
  }
  s_action_mode = mode;
  s_action_selected = 0;
  s_action_window = window_create();
  window_set_background_color(s_action_window, ACTION_BG);
  window_set_click_config_provider(s_action_window, action_click_config_provider);
  window_set_window_handlers(s_action_window, (WindowHandlers) {
    .unload = action_window_unload
  });

  Layer *window_layer = window_get_root_layer(s_action_window);
  GRect bounds = layer_get_bounds(window_layer);
  s_action_layer = layer_create(bounds);
  layer_set_update_proc(s_action_layer, full_text_layer_update_proc);
  layer_add_child(window_layer, s_action_layer);

  window_stack_push(s_action_window, true);
}

static void dictation_callback(DictationSession *session, DictationSessionStatus status,
                               char *transcription, void *context) {
  if (status == DictationSessionStatusSuccess && transcription) {
    copy_cstr(s_pending_text, sizeof(s_pending_text), transcription);
    s_pending_chat_command[0] = '\0';
    show_action_window(ActionMenuConfirm);
  } else {
    show_status("Dictation failed");
  }
}

static void start_dictation(void) {
  if (!s_dictation_session) {
    s_dictation_session = dictation_session_create(MAX_TEXT - 1, dictation_callback, NULL);
  }
  dictation_session_start(s_dictation_session);
}

static void action_window_unload(Window *window) {
  if (s_action_layer) {
    layer_destroy(s_action_layer);
    s_action_layer = NULL;
  }
  free_full_text_body();
  window_destroy(window);
  if (s_action_window == window) {
    s_action_window = NULL;
  }
}

static void action_up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_action_mode == ActionMenuFullText) {
    s_full_text_scroll_offset = PG_MAX(0, s_full_text_scroll_offset - CHAT_SCROLL_DELTA);
    layer_mark_dirty(s_action_layer);
    return;
  }
  if (s_action_selected > 0) {
    s_action_selected--;
    layer_mark_dirty(s_action_layer);
  }
}

static void action_down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_action_mode == ActionMenuFullText) {
    if (s_action_layer) {
      GRect bounds = layer_get_bounds(s_action_layer);
      int max_scroll = PG_MAX(0, s_full_text_height - bounds.size.h + 8);
      s_full_text_scroll_offset = PG_MIN(max_scroll, s_full_text_scroll_offset + CHAT_SCROLL_DELTA);
      layer_mark_dirty(s_action_layer);
    }
    return;
  }
  if (s_action_selected < action_item_count() - 1) {
    s_action_selected++;
    layer_mark_dirty(s_action_layer);
  }
}

static void action_back_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_action_mode == ActionMenuFullText) {
    free_full_text_body();
    close_action_window();
    return;
  }
  if (s_action_mode == ActionMenuCanned || s_action_mode == ActionMenuConfirm ||
      s_action_mode == ActionMenuReply || s_action_mode == ActionMenuReactionGrid ||
      s_action_mode == ActionMenuEmojiReplyGrid || s_action_mode == ActionMenuFullText) {
    if (s_action_mode == ActionMenuFullText) {
      free_full_text_body();
    }
    s_action_mode = ActionMenuMain;
    s_action_selected = 0;
    layer_mark_dirty(s_action_layer);
  } else {
    close_action_window();
  }
}

static void action_click_config_provider(void *context) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, REPEAT_SCROLL_MS, action_up_click_handler);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, REPEAT_SCROLL_MS, action_down_click_handler);
  window_single_click_subscribe(BUTTON_ID_BACK, action_back_click_handler);
}

static void main_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view_state == ViewStateChat) {
    show_action_window(ActionMenuMain);
  } else if (s_view_state == ViewStateChatList && s_chat_menu) {
    if (s_loading_messages) {
      show_status("Loading messages...");
      return;
    }
    MenuIndex index = menu_layer_get_selected_index(s_chat_menu);
    chat_menu_select_callback(s_chat_menu, &index, NULL);
  }
}

static void main_select_long_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view_state == ViewStateChatList && !s_chats_loading && !s_loading_messages &&
      s_chat_count > 0 && s_chat_menu) {
    MenuIndex index = menu_layer_get_selected_index(s_chat_menu);
    s_selected_chat = index.row;
    show_action_window(ActionMenuChat);
  }
}

static void main_up_click_handler(ClickRecognizerRef recognizer, void *context) {
  bool repeating = click_is_repeating(recognizer);
  if (s_view_state == ViewStateChatList && s_chat_menu) {
    if (s_loading_messages) {
      show_status("Loading messages...");
      return;
    }
    menu_layer_set_selected_next(s_chat_menu, true, MenuRowAlignCenter, !repeating);
    s_selected_chat = menu_layer_get_selected_index(s_chat_menu).row;
    if (s_selected_chat >= 0 && s_selected_chat < s_chat_count) {
      copy_cstr(s_chat_list_selected_id, sizeof(s_chat_list_selected_id), s_chats[s_selected_chat].id);
    }
    return;
  }
  if (s_view_state != ViewStateChat || !s_messages_root || s_message_count == 0) {
    return;
  }
  s_user_scrolled_messages = true;
  bool reversed_direction = s_message_scroll_direction == 1;
  s_message_scroll_direction = -1;
  finish_pending_chat_scroll();
  recalc_message_layout();
  if (repeating) {
    clear_active_image_request();
  }

  if (compose_target_is_selected() || s_selected_message < 0) {
    select_message_with_alignment(s_message_count - 1, true, !repeating);
    if (!reversed_direction) {
      maybe_prefetch_older_messages();
    }
    return;
  }

  GRect bounds = layer_get_bounds(s_messages_root);
  int margin = 6;
  int current_offset = s_chat_scroll_offset;
  bool selected_image_tall = message_image_scrolls_tall(s_selected_message, bounds, margin);
  int top = selected_image_tall ? message_image_top(s_selected_message, bounds) - margin :
                                  s_message_y[s_selected_message] - margin;
  int visible_top = clamp_scroll_offset(top);
  if (s_selected_message == 0 && current_offset <= visible_top + 2) {
    if (s_loading_older_messages) {
      show_status("Loading older...");
    } else {
      request_older_messages(false);
    }
    return;
  }
  if (!repeating && (selected_image_tall ||
      s_message_h[s_selected_message] > visible_message_height(bounds) - (margin * 2)) &&
      current_offset > visible_top) {
    set_chat_scroll_offset(PG_MAX(visible_top, current_offset - LONG_MESSAGE_SCROLL_DELTA), true);
    if (!reversed_direction) {
      maybe_prefetch_older_messages();
    }
    return;
  }
  if (s_selected_message > 0) {
    int prev_index = s_selected_message - 1;
    bool prev_is_tall = message_image_scrolls_tall(prev_index, bounds, margin) ||
                        s_message_h[prev_index] > visible_message_height(bounds) - (margin * 2);
    select_message_with_alignment(prev_index, !prev_is_tall, !repeating);
    if (!reversed_direction) {
      maybe_prefetch_older_messages();
    }
  } else {
    if (s_loading_older_messages) {
      show_status("Loading older...");
    } else {
      request_older_messages(false);
    }
  }
}

static void main_down_click_handler(ClickRecognizerRef recognizer, void *context) {
  bool repeating = click_is_repeating(recognizer);
  if (s_view_state == ViewStateChatList && s_chat_menu) {
    if (s_loading_messages) {
      show_status("Loading messages...");
      return;
    }
    menu_layer_set_selected_next(s_chat_menu, false, MenuRowAlignCenter, !repeating);
    s_selected_chat = menu_layer_get_selected_index(s_chat_menu).row;
    if (s_selected_chat >= 0 && s_selected_chat < s_chat_count) {
      copy_cstr(s_chat_list_selected_id, sizeof(s_chat_list_selected_id), s_chats[s_selected_chat].id);
    }
    return;
  }
  if (s_view_state != ViewStateChat || !s_messages_root || s_message_count == 0) {
    return;
  }
  s_user_scrolled_messages = true;
  bool reversed_direction = s_message_scroll_direction == -1;
  s_message_scroll_direction = 1;
  finish_pending_chat_scroll();
  recalc_message_layout();
  if (repeating) {
    clear_active_image_request();
  }

  if (compose_target_is_selected() || s_selected_message < 0) {
    if (s_at_newest) {
      scroll_to_bottom(!repeating);
    } else if (s_message_count > 0) {
      select_message_with_alignment(s_message_count - 1, false, !repeating);
      if (!reversed_direction) {
        maybe_prefetch_newer_messages();
      }
    }
    return;
  }

  GRect bounds = layer_get_bounds(s_messages_root);
  int margin = 6;
  int current_offset = s_chat_scroll_offset;
  bool selected_image_tall = message_image_scrolls_tall(s_selected_message, bounds, margin);
  int bottom = selected_image_tall ?
               message_image_edge_scroll_target(s_selected_message, bounds, margin, false) +
               visible_message_height(bounds) :
               s_message_y[s_selected_message] + s_message_h[s_selected_message] + margin;
  if (!repeating && (selected_image_tall ||
      s_message_h[s_selected_message] > visible_message_height(bounds) - (margin * 2)) &&
      current_offset + visible_message_height(bounds) < bottom) {
    set_chat_scroll_offset(PG_MIN(bottom - visible_message_height(bounds),
                                  current_offset + LONG_MESSAGE_SCROLL_DELTA), true);
    if (!reversed_direction) {
      maybe_prefetch_newer_messages();
    }
    return;
  }
  if (s_selected_message < s_message_count - 1) {
    int next_index = s_selected_message + 1;
    bool next_is_tall = message_image_scrolls_tall(next_index, bounds, margin) ||
                        s_message_h[next_index] > visible_message_height(bounds) - (margin * 2);
    select_message_with_alignment(next_index, next_is_tall, !repeating);
    if (!reversed_direction) {
      maybe_prefetch_newer_messages();
    }
  } else if (s_loading_newer_messages) {
    show_status("Loading newer...");
  } else if (s_at_newest) {
    scroll_to_bottom(!repeating);
  } else {
    request_newer_messages(false);
  }
}

static void main_back_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_touch_keyboard_open) {
    close_touch_keyboard();
    show_status(s_current_chat_title);
    return;
  }
  if (s_view_state == ViewStateChat) {
    cancel_message_timeout();
    cancel_message_retry();
    s_loading_messages = false;
    s_loading_older_messages = false;
    s_loading_newer_messages = false;
    s_message_transfer_id = 0;
    s_chat_view_pending = false;
    clear_message_stage();
    reset_touch_keyboard();
    send_command_with_status("leave_chat", s_current_chat_id, NULL, NULL, NULL, false);
    render_chat_list_with_transition();
  } else {
    window_stack_pop(true);
  }
}

static void click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, main_select_click_handler);
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, main_select_long_click_handler, NULL);
  window_single_repeating_click_subscribe(BUTTON_ID_UP, REPEAT_SCROLL_MS, main_up_click_handler);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, REPEAT_SCROLL_MS, main_down_click_handler);
  window_single_click_subscribe(BUTTON_ID_BACK, main_back_click_handler);
}

static void main_window_load(Window *window) {
  window_set_background_color(window, CHAT_BG);
  window_set_click_config_provider(window, click_config_provider);
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  GRect status_rect = ROUND_UI ? GRect(24, chat_status_y(), bounds.size.w - 48, STATUS_H) :
                                 GRect(0, 0, bounds.size.w, STATUS_H);
  s_status_layer = text_layer_create(status_rect);
  text_layer_set_text(s_status_layer, "Pebblegram");
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_text_color(s_status_layer, GColorWhite);
  text_layer_set_background_color(s_status_layer, APP_COLOR);
  layer_add_child(window_layer, text_layer_get_layer(s_status_layer));

  int content_y = chat_content_y();
  int bottom_pad = chat_bottom_pad();
  s_chat_menu = menu_layer_create(GRect(0, content_y, bounds.size.w, bounds.size.h - content_y - bottom_pad));
  if (ROUND_UI) {
    menu_layer_set_center_focused(s_chat_menu, false);
  }
  menu_layer_set_callbacks(s_chat_menu, NULL, (MenuLayerCallbacks) {
    .get_num_sections = chat_menu_get_num_sections_callback,
    .get_num_rows = chat_menu_get_num_rows_callback,
    .get_header_height = chat_menu_get_header_height_callback,
    .draw_row = chat_menu_draw_row_callback,
    .get_cell_height = chat_menu_get_cell_height_callback,
    .select_click = chat_menu_select_callback
  });
  layer_add_child(window_layer, menu_layer_get_layer(s_chat_menu));
}

static void main_window_unload(Window *window) {
  light_enable(false);
  cancel_status_clear();
  destroy_chat_view();
  destroy_chat_avatars();
  destroy_message_images();
  if (s_chat_menu) {
    menu_layer_destroy(s_chat_menu);
    s_chat_menu = NULL;
  }
  if (s_status_layer) {
    text_layer_destroy(s_status_layer);
    s_status_layer = NULL;
  }
}

static void main_window_appear(Window *window) {
  light_enable(false);
}

static void init(void) {
  s_view_state = ViewStateChatList;
  s_selected_message = -1;
  s_chats_loading = true;
  light_enable(false);

  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_open(APP_INBOX_SIZE, APP_OUTBOX_SIZE);
#if TOUCH_KEYBOARD_AVAILABLE
  if (touch_keyboard_supported()) {
    touch_service_subscribe(touch_handler, NULL);
  }
#endif

  s_main_window = window_create();
  window_set_click_config_provider(s_main_window, click_config_provider);
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .appear = main_window_appear,
    .unload = main_window_unload
  });
  window_stack_push(s_main_window, true);
  s_startup_wake_timer = app_timer_register(PHONE_WAKE_DELAY_MS, startup_wake_timer_callback, NULL);
}

static void deinit(void) {
  light_enable(false);
  if (s_startup_wake_timer) {
    app_timer_cancel(s_startup_wake_timer);
    s_startup_wake_timer = NULL;
  }
  if (s_chat_retry_timer) {
    app_timer_cancel(s_chat_retry_timer);
    s_chat_retry_timer = NULL;
  }
  destroy_chat_avatars();
  destroy_message_images();
  if (s_dictation_session) {
    dictation_session_destroy(s_dictation_session);
  }
  free_image_transfer_buffer();
  free_avatar_transfer_buffer();
  free_full_text_body();
#if TOUCH_KEYBOARD_AVAILABLE
  if (touch_keyboard_supported()) {
    touch_service_unsubscribe();
  }
#endif
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
