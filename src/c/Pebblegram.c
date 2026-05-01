#include <pebble.h>
#include <stdlib.h>
#include <string.h>
#include "message_keys.auto.h"

#define MAX_CHATS 20
#define MAX_MESSAGES PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 20, 20, 20, 20, 24, 24, 24)
#define MAX_TEXT PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 360, 360, 360, 360, 560, 560, 560)
#define MESSAGE_PREVIEW_TEXT PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 96, 96, 96, 96, 180, 180, 180)
#define MAX_SENDER 36
#define MAX_ID 24
#define MAX_IMAGE_BYTES PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 10000, 10000, 10000, 6000, 20000, 20000, 20000)
#define MAX_LOADED_IMAGES 1
#define IMAGE_THUMB_SIZE PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 120, 120, 120, 96, 156, 156, 118)
#define APP_INBOX_SIZE PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 2048, 2048, 2048, 2048, 4096, 4096, 4096)
#define APP_OUTBOX_SIZE PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 512, 512, 512, 512, 1024, 1024, 1024)
#define BW_UI PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 0, 0, 0, 1, 0, 0, 0)
#define ROUND_UI PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 0, 0, 0, 0, 0, 0, 1)
#define STATUS_H PBL_PLATFORM_SWITCH(PBL_PLATFORM_TYPE_CURRENT, 24, 24, 24, 24, 24, 24, 22)
#define MAX_CANNED 5
#define CANNED_TEXT_LEN 40
#define PG_MIN(a, b) ((a) < (b) ? (a) : (b))
#define PG_MAX(a, b) ((a) > (b) ? (a) : (b))
#define APP_COLOR GColorVividCerulean
#define APP_COLOR_LIGHT GColorPictonBlue
#define CHAT_BG GColorWhite
#define IN_BUBBLE GColorWhite
#define OUT_BUBBLE GColorCeleste
#define SELECTED_IN_BUBBLE GColorLightGray
#define SELECTED_OUT_BUBBLE GColorPictonBlue
#define ACTION_BG GColorBlack
#define ACTION_TEXT GColorLightGray
#define ACTION_TEXT_SELECTED GColorWhite
#define CHAT_SCROLL_STEPS 3
#define CHAT_SCROLL_FRAME_MS 12
#define CHAT_SCROLL_DELTA 24
#define COMPOSE_BUBBLE_H 30
#define COMPOSE_BUBBLE_GAP 8
#define MESSAGE_COMMAND_RETRY_MS 3000
#define MESSAGE_COMMAND_MAX_ATTEMPTS 3

// Platform constants are centralized here. Basalt/Diorite stay conservative on
// heap use; Emery/Gabbro can afford longer text and larger image payloads.
typedef enum {
  ViewStateLoading,
  ViewStateChatList,
  ViewStateChat
} ViewState;

typedef enum {
  ActionMenuMain,
  ActionMenuCanned,
  ActionMenuConfirm,
  ActionMenuFullText
} ActionMenuMode;

typedef enum {
  ActionItemCompose,
  ActionItemCanned,
  ActionItemDelete,
  ActionItemFullText,
  ActionItemRefresh
} ActionItem;

typedef struct {
  char id[MAX_ID];
  char title[48];
  char preview[72];
  bool unread;
} Chat;

typedef struct {
  char id[MAX_ID];
  char sender[MAX_SENDER];
  char text[MAX_TEXT];
  char image_token[MAX_ID];
  bool outgoing;
  bool image_placeholder;
  bool image_requested;
  bool image_failed;
  GBitmap *image_bitmap;
} Message;

static Window *s_main_window;
static MenuLayer *s_chat_menu;
static TextLayer *s_status_layer;
static Layer *s_messages_root;

static Window *s_action_window;
static Layer *s_action_layer;
static ActionMenuMode s_action_mode;
static int s_action_selected;
static int s_full_text_scroll_offset;
static int s_full_text_height;

static DictationSession *s_dictation_session;

static Chat s_chats[MAX_CHATS];
static Message s_messages[MAX_MESSAGES];
static int s_message_y[MAX_MESSAGES];
static int s_message_h[MAX_MESSAGES];
static int s_compose_bubble_y;
static uint8_t s_image_buffer[MAX_IMAGE_BYTES];
static char s_image_message_id[MAX_ID];
static int s_image_size;
static int s_image_received;
static int s_loaded_image_count;
static char s_canned[MAX_CANNED][CANNED_TEXT_LEN] = {
  "Yes",
  "No",
  "On my way",
  "Call you later",
  "Thanks"
};
static char s_pending_text[MAX_TEXT];
static char s_current_chat_id[MAX_ID];
static char s_current_chat_title[48];
static char s_status_text[64];

static int s_chat_count;
static int s_message_count;
static int s_selected_chat;
static int s_selected_message;
static int s_expected_rows;
static int s_chat_scroll_offset;
static int s_chat_scroll_start;
static int s_chat_scroll_target;
static int s_chat_scroll_step;
static int s_chat_content_height;
static ViewState s_view_state;
static bool s_bridge_ready;
static bool s_chat_view_pending;
static bool s_loading_older_messages;
static bool s_older_move_to_previous;
static bool s_user_scrolled_messages;
static char s_older_anchor_id[MAX_ID];
static AppTimer *s_chat_scroll_timer;
static AppTimer *s_message_timeout_timer;
static AppTimer *s_message_retry_timer;
static int s_message_request_attempts;

static void request_chats(void);
static void request_messages(const char *chat_id);
static void request_next_image(void);
static void request_older_messages(bool move_to_previous, bool silent);
static void destroy_message_images(void);
static void destroy_offscreen_message_images(void);
static void message_retry_timer_callback(void *data);
static void main_back_click_handler(ClickRecognizerRef recognizer, void *context);
static void send_text_message(const char *text, bool as_reply);
static void delete_selected_message(void);
static void render_chat_list(void);
static void render_messages(void);
static void show_chat_view_timer(void *data);
static void message_timeout_timer_callback(void *data);
static void show_status(const char *message);
static void click_config_provider(void *context);
static void copy_cstr(char *dest, size_t dest_size, const char *src);
static void action_click_config_provider(void *context);
static void action_window_unload(Window *window);
static bool selected_message_is_truncated(void);
static bool has_selected_message(void);
static bool compose_target_is_selected(void);
static void recalc_message_layout(void);
static void set_chat_scroll_offset(int target, bool animated);
static void scroll_selected_message_into_view(bool animated);
static void select_message_with_alignment(int index, bool align_bottom, bool animated);
static void chat_scroll_timer_callback(void *data);
static void messages_root_update_proc(Layer *layer, GContext *ctx);

static void update_canned_replies(const char *packed) {
  if (!packed || !packed[0]) {
    return;
  }

  char buffer[MAX_CANNED * CANNED_TEXT_LEN];
  copy_cstr(buffer, sizeof(buffer), packed);

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

static int chat_status_y(void) {
  return ROUND_UI ? 6 : 0;
}

static int chat_content_y(void) {
  return ROUND_UI ? 48 : STATUS_H;
}

static int chat_bottom_pad(void) {
  return ROUND_UI ? 24 : 0;
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

static void destroy_message_images(void) {
  for (int i = 0; i < MAX_MESSAGES; i++) {
    if (s_messages[i].image_bitmap) {
      gbitmap_destroy(s_messages[i].image_bitmap);
      s_messages[i].image_bitmap = NULL;
    }
    s_messages[i].image_requested = false;
    s_messages[i].image_failed = false;
  }
  s_loaded_image_count = 0;
  s_image_size = 0;
  s_image_received = 0;
  s_image_message_id[0] = '\0';
}

static bool message_intersects_view(int index, int margin) {
  if (!s_messages_root || index < 0 || index >= s_message_count) {
    return false;
  }
  GRect bounds = layer_get_bounds(s_messages_root);
  int top = s_message_y[index];
  int bottom = top + s_message_h[index];
  return bottom >= s_chat_scroll_offset - margin &&
         top <= s_chat_scroll_offset + bounds.size.h + margin;
}

static void destroy_offscreen_message_images(void) {
  for (int i = 0; i < MAX_MESSAGES; i++) {
    if (!message_intersects_view(i, 32) && s_messages[i].image_bitmap) {
      gbitmap_destroy(s_messages[i].image_bitmap);
      s_messages[i].image_bitmap = NULL;
      s_messages[i].image_requested = false;
    }
  }
  s_loaded_image_count = 0;
  for (int i = 0; i < MAX_MESSAGES; i++) {
    if (s_messages[i].image_bitmap) {
      s_loaded_image_count++;
    }
  }
}

static bool send_command(const char *command, const char *chat_id, const char *text,
                         const char *reply_to, const char *message_id) {
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK || !iter) {
    show_status("Bridge busy");
    return false;
  }

  DictionaryResult dict_result = dict_write_cstring(iter, MESSAGE_KEY_Command, command);
  if (dict_result != DICT_OK) {
    show_status("Command write fail");
    return false;
  }
  if (chat_id) {
    dict_result = dict_write_cstring(iter, MESSAGE_KEY_ChatId, chat_id);
    if (dict_result != DICT_OK) {
      show_status("Chat ID write fail");
      return false;
    }
  }
  if (text) {
    dict_result = dict_write_cstring(iter, MESSAGE_KEY_Text, text);
    if (dict_result != DICT_OK) {
      show_status("Text write fail");
      return false;
    }
  }
  if (reply_to) {
    dict_result = dict_write_cstring(iter, MESSAGE_KEY_ReplyTo, reply_to);
    if (dict_result != DICT_OK) {
      show_status("Reply write fail");
      return false;
    }
  }
  if (message_id) {
    dict_result = dict_write_cstring(iter, MESSAGE_KEY_MessageId, message_id);
    if (dict_result != DICT_OK) {
      show_status("Msg ID write fail");
      return false;
    }
  }
  dict_write_end(iter);
  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    show_status("Command send fail");
    return false;
  }
  return true;
}

static void show_status(const char *message) {
  if (s_status_layer) {
    copy_cstr(s_status_text, sizeof(s_status_text), message);
    text_layer_set_text(s_status_layer, s_status_text);
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
  if (selected) {
    graphics_context_set_fill_color(ctx, APP_COLOR_LIGHT);
    graphics_fill_rect(ctx, GRect(safe.origin.x - 4, 1, safe.size.w + 8, bounds.size.h - 3),
                       ROUND_UI ? 5 : 0, GCornersAll);
  }
  graphics_context_set_stroke_color(ctx, GColorLightGray);
  graphics_draw_line(ctx, GPoint(safe.origin.x, bounds.size.h - 1),
                     GPoint(safe.origin.x + safe.size.w, bounds.size.h - 1));

  graphics_context_set_text_color(ctx, selected ? GColorWhite : GColorBlack);
  if (s_chat_count == 0) {
    graphics_draw_text(ctx, s_bridge_ready ? "No chats yet" : "Loading...",
                       fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                       GRect(safe.origin.x, ROUND_UI ? 22 : 34, safe.size.w, 40), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentCenter, NULL);
    return;
  }

  Chat *chat = &s_chats[cell_index->row];
  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  graphics_draw_text(ctx, chat->title, title_font, GRect(safe.origin.x, -4, safe.size.w, 25),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, selected ? GColorWhite : GColorDarkGray);
  graphics_draw_text(ctx, chat->preview, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(safe.origin.x, 20, safe.size.w, 23), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
}

static int16_t chat_menu_get_cell_height_callback(struct MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
  return ROUND_UI ? 42 : 46;
}

static void chat_menu_select_callback(struct MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
  if (s_chat_count == 0) {
    request_chats();
    return;
  }
  s_selected_chat = cell_index->row;
  copy_cstr(s_current_chat_id, sizeof(s_current_chat_id), s_chats[s_selected_chat].id);
  copy_cstr(s_current_chat_title, sizeof(s_current_chat_title), s_chats[s_selected_chat].title);
  APP_LOG(APP_LOG_LEVEL_INFO, "Requesting messages for chat %s", s_current_chat_id);
  request_messages(s_current_chat_id);
}

static int clamp_scroll_offset(int offset) {
  if (!s_messages_root) {
    return 0;
  }
  GRect bounds = layer_get_bounds(s_messages_root);
  int max_offset = PG_MAX(0, s_chat_content_height - bounds.size.h);
  return PG_MAX(0, PG_MIN(offset, max_offset));
}

static int message_bubble_height(Message *message, int text_w) {
  char display_text[MESSAGE_PREVIEW_TEXT + 8];
  GFont text_font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  int name_h = (!message->outgoing && message->sender[0]) ? 16 : 0;
  int image_h = message->image_placeholder ? IMAGE_THUMB_SIZE + 8 : 0;
  copy_cstr(display_text, sizeof(display_text), message->text);
  if ((int)strlen(message->text) > MESSAGE_PREVIEW_TEXT) {
    copy_cstr(display_text + MESSAGE_PREVIEW_TEXT - 4, sizeof(display_text) - MESSAGE_PREVIEW_TEXT + 4, " ...");
  }
  GSize size = graphics_text_layout_get_content_size(
    display_text,
    text_font,
    GRect(0, 0, text_w, 2000),
    GTextOverflowModeWordWrap,
    GTextAlignmentLeft
  );
  int text_h = display_text[0] ? size.h : 0;
  return PG_MAX(28, text_h + name_h + image_h + 7);
}

static void recalc_message_layout(void) {
  if (!s_messages_root) {
    return;
  }

  GRect bounds = layer_get_bounds(s_messages_root);
  int bubble_w = message_bubble_width(bounds);
  int text_w = bubble_w - 10;
  int y = ROUND_UI ? 8 : 3;

  for (int i = 0; i < s_message_count; i++) {
    s_message_y[i] = y;
    s_message_h[i] = message_bubble_height(&s_messages[i], text_w);
    y += s_message_h[i] + (ROUND_UI ? 6 : 5);
  }
  int compose_min_y = bounds.size.h - COMPOSE_BUBBLE_H - (ROUND_UI ? 8 : 6);
  s_compose_bubble_y = PG_MAX(y + COMPOSE_BUBBLE_GAP, compose_min_y);
  s_chat_content_height = s_compose_bubble_y + COMPOSE_BUBBLE_H + (ROUND_UI ? 12 : 5);
  s_chat_scroll_offset = clamp_scroll_offset(s_chat_scroll_offset);
}

static void scroll_to_bottom(bool animated) {
  recalc_message_layout();
  s_selected_message = s_message_count;
  set_chat_scroll_offset(s_chat_content_height, animated);
  destroy_offscreen_message_images();
  request_next_image();
}

static void chat_scroll_timer_callback(void *data) {
  s_chat_scroll_timer = NULL;
  s_chat_scroll_step++;

  if (s_chat_scroll_step >= CHAT_SCROLL_STEPS) {
    s_chat_scroll_offset = s_chat_scroll_target;
  } else {
    int delta = s_chat_scroll_target - s_chat_scroll_start;
    s_chat_scroll_offset = s_chat_scroll_start + ((delta * s_chat_scroll_step) / CHAT_SCROLL_STEPS);
    s_chat_scroll_timer = app_timer_register(CHAT_SCROLL_FRAME_MS, chat_scroll_timer_callback, NULL);
  }

  if (s_messages_root) {
    layer_mark_dirty(s_messages_root);
  }
  request_next_image();
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

// Long messages stay selected while the user scrolls through them line by line.
static void scroll_selected_message_into_view(bool animated) {
  if (!s_messages_root || s_selected_message < 0 || s_selected_message >= s_message_count) {
    return;
  }

  recalc_message_layout();
  GRect bounds = layer_get_bounds(s_messages_root);
  int margin = 8;
  int top = s_message_y[s_selected_message] - margin;
  int bottom = s_message_y[s_selected_message] + s_message_h[s_selected_message] + margin;
  int target = s_chat_scroll_offset;

  if (s_message_h[s_selected_message] > bounds.size.h - (margin * 2)) {
    target = top;
  } else if (top < s_chat_scroll_offset) {
    target = top;
  } else if (bottom > s_chat_scroll_offset + bounds.size.h) {
    target = bottom - bounds.size.h;
  }

  set_chat_scroll_offset(target, animated);
  request_next_image();
}

static void select_message_with_alignment(int index, bool align_bottom, bool animated) {
  if (!s_messages_root || index < 0 || index >= s_message_count) {
    return;
  }

  s_selected_message = index;
  recalc_message_layout();
  GRect bounds = layer_get_bounds(s_messages_root);
  int margin = 6;
  int top = s_message_y[s_selected_message] - margin;
  int bottom = s_message_y[s_selected_message] + s_message_h[s_selected_message] + margin;

  if (s_message_h[s_selected_message] > bounds.size.h - (margin * 2)) {
    set_chat_scroll_offset(align_bottom ? bottom - bounds.size.h : top, animated);
    request_next_image();
    return;
  }

  scroll_selected_message_into_view(animated);
}

static void render_messages(void) {
  if (!s_messages_root) {
    return;
  }
  recalc_message_layout();
  if (s_selected_message >= 0 && s_selected_message < s_message_count) {
    scroll_selected_message_into_view(false);
  } else {
    scroll_to_bottom(false);
  }
}

static void messages_root_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, CHAT_BG);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  if (s_message_count == 0) {
    graphics_context_set_text_color(ctx, GColorDarkGray);
    graphics_draw_text(ctx, "No messages loaded", fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                       GRect(8, 40, bounds.size.w - 16, 80), GTextOverflowModeWordWrap,
                       GTextAlignmentCenter, NULL);
  }

  recalc_message_layout();
  GFont text_font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  GFont sender_font = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
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
    int y = s_message_y[i] - s_chat_scroll_offset;
    int bubble_h = s_message_h[i];

    if (y > bounds.size.h) {
      break;
    }

    copy_cstr(display_text, sizeof(display_text), message->text);
    if (truncated) {
      copy_cstr(display_text + MESSAGE_PREVIEW_TEXT - 4, sizeof(display_text) - MESSAGE_PREVIEW_TEXT + 4, " ...");
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
    graphics_context_set_text_color(ctx, GColorBlack);
    int image_h = message->image_placeholder ? IMAGE_THUMB_SIZE + 8 : 0;
    if (display_text[0]) {
      graphics_draw_text(ctx, display_text, text_font, GRect(x + 5, text_y, text_w, bubble_h - name_h - image_h - 6),
                         GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
    }

    if (message->image_placeholder) {
      GRect image_rect = GRect(message->outgoing ? x + bubble_w - IMAGE_THUMB_SIZE - 5 : x + 5,
                              y + bubble_h - IMAGE_THUMB_SIZE - 4,
                              IMAGE_THUMB_SIZE, IMAGE_THUMB_SIZE);
      if (message->image_bitmap) {
        graphics_draw_bitmap_in_rect(ctx, message->image_bitmap, image_rect);
      } else {
        const char *label = message->image_failed ? "Photo failed" :
                            (message->image_requested ? "Loading photo" : "Photo");
        graphics_context_set_stroke_color(ctx, BW_UI ? GColorBlack : GColorLightGray);
        graphics_draw_round_rect(ctx, image_rect, 4);
        graphics_context_set_text_color(ctx, GColorDarkGray);
        graphics_draw_text(ctx, label, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                           GRect(image_rect.origin.x + 4, image_rect.origin.y + 20,
                                 image_rect.size.w - 8, 30),
                           GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
      }
    }
  }

  int compose_w = PG_MIN(bounds.size.w - 24, ROUND_UI ? 120 : 132);
  int compose_x = (bounds.size.w - compose_w) / 2;
  int compose_y = s_compose_bubble_y - s_chat_scroll_offset;
  bool compose_selected = compose_target_is_selected();
  GRect compose_rect = GRect(compose_x, compose_y, compose_w, COMPOSE_BUBBLE_H);
  if (compose_y < bounds.size.h && compose_y + COMPOSE_BUBBLE_H > 0) {
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
    graphics_draw_text(ctx, "New message", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(compose_rect.origin.x + 8, compose_rect.origin.y + 3,
                             compose_rect.size.w - 16, compose_rect.size.h - 5),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }
}

static void destroy_chat_view(void) {
  if (s_chat_scroll_timer) {
    app_timer_cancel(s_chat_scroll_timer);
    s_chat_scroll_timer = NULL;
  }
  if (s_messages_root) {
    layer_destroy(s_messages_root);
    s_messages_root = NULL;
  }
}

static void show_chat_view(void) {
  s_chat_view_pending = false;
  s_view_state = ViewStateChat;
  window_set_click_config_provider(s_main_window, click_config_provider);
  destroy_chat_view();
  if (s_chat_menu) {
    layer_set_hidden(menu_layer_get_layer(s_chat_menu), true);
  }
  show_status(s_current_chat_title);

  Layer *window_layer = window_get_root_layer(s_main_window);
  GRect bounds = layer_get_bounds(window_layer);
  int content_y = chat_content_y();
  int bottom_pad = chat_bottom_pad();
  s_messages_root = layer_create(GRect(0, content_y, bounds.size.w, bounds.size.h - content_y - bottom_pad));
  layer_set_update_proc(s_messages_root, messages_root_update_proc);
  layer_add_child(window_layer, s_messages_root);
  s_chat_scroll_offset = 0;
  s_chat_content_height = 0;
  recalc_message_layout();
  if (s_message_count > 0) {
    s_chat_scroll_offset = clamp_scroll_offset(s_chat_content_height);
  }
  render_messages();
}

static void show_chat_view_timer(void *data) {
  show_chat_view();
}

static void render_chat_list(void) {
  s_view_state = ViewStateChatList;
  window_set_click_config_provider(s_main_window, click_config_provider);
  destroy_chat_view();
  if (s_chat_menu) {
    layer_set_hidden(menu_layer_get_layer(s_chat_menu), false);
    menu_layer_reload_data(s_chat_menu);
  }
  show_status("Pebblegram");
}

static void request_chats(void) {
  s_view_state = ViewStateChatList;
  destroy_message_images();
  s_chat_count = 0;
  s_expected_rows = 0;
  s_bridge_ready = false;
  show_status("Loading chats...");
  if (s_chat_menu) {
    menu_layer_reload_data(s_chat_menu);
  }
  send_command("get_chats", NULL, NULL, NULL, NULL);
}

static void cancel_message_timeout(void) {
  if (s_message_timeout_timer) {
    app_timer_cancel(s_message_timeout_timer);
    s_message_timeout_timer = NULL;
  }
}

static void cancel_message_retry(void) {
  if (s_message_retry_timer) {
    app_timer_cancel(s_message_retry_timer);
    s_message_retry_timer = NULL;
  }
}

static void message_timeout_timer_callback(void *data) {
  s_message_timeout_timer = NULL;
  if (s_view_state != ViewStateChat && s_message_count == 0 && !s_chat_view_pending) {
    show_status("Messages failed");
  }
}

static void message_retry_timer_callback(void *data) {
  s_message_retry_timer = NULL;
  if (s_view_state == ViewStateChat || s_message_count > 0 || s_chat_view_pending) {
    return;
  }
  if (s_message_request_attempts >= MESSAGE_COMMAND_MAX_ATTEMPTS) {
    return;
  }

  s_message_request_attempts++;
  if (send_command("get_messages", s_current_chat_id, NULL, NULL, NULL) &&
      s_message_request_attempts < MESSAGE_COMMAND_MAX_ATTEMPTS) {
    s_message_retry_timer = app_timer_register(MESSAGE_COMMAND_RETRY_MS, message_retry_timer_callback, NULL);
  }
}

// Load the first photo that is visible or just about to enter view. This keeps
// heap use predictable while still prefetching as the user scrolls.
static void request_next_image(void) {
  if (!s_messages_root || s_message_count == 0) {
    return;
  }
  recalc_message_layout();
  destroy_offscreen_message_images();

  if (s_loaded_image_count >= MAX_LOADED_IMAGES) {
    return;
  }

  for (int i = 0; i < s_message_count; i++) {
    Message *message = &s_messages[i];
    if (!message_intersects_view(i, 16) || !message->image_placeholder || !message->image_token[0] ||
        message->image_requested || message->image_bitmap || message->image_failed) {
      continue;
    }
    if (send_command("get_image", s_current_chat_id, NULL, NULL, message->image_token)) {
      message->image_requested = true;
    } else {
      message->image_failed = true;
    }
    if (s_messages_root) {
      layer_mark_dirty(s_messages_root);
    }
    return;
  }
}

static void request_older_messages(bool move_to_previous, bool silent) {
  if (s_message_count <= 0 || !s_messages[0].id[0]) {
    if (!silent) {
      show_status("No older messages");
    }
    return;
  }
  if (s_loading_older_messages) {
    return;
  }
  if (s_selected_message >= 0 && s_selected_message < s_message_count) {
    copy_cstr(s_older_anchor_id, sizeof(s_older_anchor_id), s_messages[s_selected_message].id);
  } else {
    s_older_anchor_id[0] = '\0';
  }
  s_older_move_to_previous = move_to_previous;
  s_loading_older_messages = true;
  if (!silent) {
    show_status("Loading older...");
  }
  if (!send_command("get_older_messages", s_current_chat_id, NULL, NULL, s_messages[0].id)) {
    s_loading_older_messages = false;
    s_older_move_to_previous = false;
    s_older_anchor_id[0] = '\0';
  }
}

static void request_messages(const char *chat_id) {
  cancel_message_timeout();
  cancel_message_retry();
  destroy_message_images();
  s_loading_older_messages = false;
  s_older_move_to_previous = false;
  s_older_anchor_id[0] = '\0';
  s_message_count = 0;
  s_expected_rows = 0;
  s_selected_message = -1;
  s_user_scrolled_messages = false;
  s_chat_view_pending = false;
  s_message_request_attempts = 1;
  show_status("Loading messages...");
  if (send_command("get_messages", chat_id, NULL, NULL, NULL)) {
    s_message_retry_timer = app_timer_register(MESSAGE_COMMAND_RETRY_MS, message_retry_timer_callback, NULL);
  }
  s_message_timeout_timer = app_timer_register(20000, message_timeout_timer_callback, NULL);
}

static void send_text_message(const char *text, bool as_reply) {
  const char *reply_to = NULL;
  if (as_reply && s_selected_message >= 0 && s_selected_message < s_message_count) {
    reply_to = s_messages[s_selected_message].id;
  }
  show_status("Sending...");
  send_command("send_message", s_current_chat_id, text, reply_to, NULL);
}

static bool has_selected_message(void) {
  return s_selected_message >= 0 && s_selected_message < s_message_count;
}

static bool compose_target_is_selected(void) {
  return s_selected_message == s_message_count;
}

static bool selected_message_is_truncated(void) {
  return has_selected_message() &&
         (int)strlen(s_messages[s_selected_message].text) > MESSAGE_PREVIEW_TEXT;
}

static void delete_selected_message(void) {
  if (s_selected_message < 0 || s_selected_message >= s_message_count) {
    return;
  }
  show_status("Deleting...");
  send_command("delete_message", s_current_chat_id, NULL, NULL, s_messages[s_selected_message].id);
}

static void inbox_received_callback(DictionaryIterator *iter, void *context) {
  char *type = tuple_cstring(iter, MESSAGE_KEY_Type);
  if (!type) {
    return;
  }

  if (strcmp(type, "status") == 0) {
    char *status = tuple_cstring(iter, MESSAGE_KEY_Status);
    if (status) {
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
    cancel_message_timeout();
    cancel_message_retry();
    show_status(error ? error : "Bridge error");
    if (s_view_state != ViewStateChat) {
      s_bridge_ready = false;
      if (s_chat_menu) {
        menu_layer_reload_data(s_chat_menu);
      }
    }
    return;
  }

  int index = tuple_int(iter, MESSAGE_KEY_Index, 0);
  int count = tuple_int(iter, MESSAGE_KEY_Count, 0);
  s_expected_rows = count;

  if (strcmp(type, "chats_done") == 0) {
    if (s_view_state == ViewStateLoading) {
      s_view_state = ViewStateChatList;
    }
    s_bridge_ready = true;
    if (s_chat_count > count) {
      s_chat_count = count;
    }
    if (s_chat_menu) {
      menu_layer_reload_data(s_chat_menu);
    }
    show_status("Pebblegram");
    return;
  }

  if (strcmp(type, "messages_done") == 0) {
    cancel_message_timeout();
    cancel_message_retry();
    char selected_id[MAX_ID];
    selected_id[0] = '\0';
    if (s_loading_older_messages && s_older_anchor_id[0]) {
      copy_cstr(selected_id, sizeof(selected_id), s_older_anchor_id);
    } else if (s_user_scrolled_messages && s_selected_message >= 0 && s_selected_message < s_message_count) {
      copy_cstr(selected_id, sizeof(selected_id), s_messages[s_selected_message].id);
    }
    if (s_message_count > count) {
      s_message_count = count;
    }
    int preserved_index = find_message_index_by_id(selected_id);
    if (preserved_index >= 0) {
      s_selected_message = (s_older_move_to_previous && preserved_index > 0) ?
                           preserved_index - 1 : preserved_index;
    } else if (!s_user_scrolled_messages && !s_loading_older_messages) {
      s_selected_message = s_message_count;
    } else {
      s_selected_message = s_message_count > 0 ? (s_loading_older_messages ? 1 : s_message_count - 1) : -1;
    }
    s_loading_older_messages = false;
    s_older_move_to_previous = false;
    s_older_anchor_id[0] = '\0';
    s_expected_rows = count;
    if (!s_chat_view_pending) {
      s_chat_view_pending = true;
      app_timer_register(1, show_chat_view_timer, NULL);
    } else if (s_view_state == ViewStateChat && s_messages_root) {
      recalc_message_layout();
      if (has_selected_message()) {
        scroll_selected_message_into_view(false);
      } else {
        scroll_to_bottom(false);
      }
      layer_mark_dirty(s_messages_root);
    }
    return;
  }

  if (strcmp(type, "chat") == 0 && index >= 0 && index < MAX_CHATS) {
    if (s_view_state == ViewStateLoading) {
      s_view_state = ViewStateChatList;
    }
    Chat *chat = &s_chats[index];
    copy_cstr(chat->id, sizeof(chat->id), tuple_cstring(iter, MESSAGE_KEY_ChatId));
    copy_cstr(chat->title, sizeof(chat->title), tuple_cstring(iter, MESSAGE_KEY_Sender));
    copy_cstr(chat->preview, sizeof(chat->preview), tuple_cstring(iter, MESSAGE_KEY_Text));
    chat->unread = tuple_int(iter, MESSAGE_KEY_IsUnread, 0) != 0;
    if (index + 1 > s_chat_count) {
      s_chat_count = index + 1;
    }
    s_bridge_ready = true;
    if (s_chat_menu) {
      menu_layer_reload_data(s_chat_menu);
    }
    if (s_chat_count >= s_expected_rows) {
      show_status("Pebblegram");
    }
    return;
  }

  if (strcmp(type, "message") == 0 && index >= 0 && index < MAX_MESSAGES) {
    cancel_message_timeout();
    cancel_message_retry();
    Message *message = &s_messages[index];
    copy_cstr(message->id, sizeof(message->id), tuple_cstring(iter, MESSAGE_KEY_MessageId));
    copy_cstr(message->sender, sizeof(message->sender), tuple_cstring(iter, MESSAGE_KEY_Sender));
    copy_cstr(message->text, sizeof(message->text), tuple_cstring(iter, MESSAGE_KEY_Text));
    message->outgoing = tuple_int(iter, MESSAGE_KEY_IsOutgoing, 0) != 0;
    copy_cstr(message->image_token, sizeof(message->image_token), tuple_cstring(iter, MESSAGE_KEY_ImageToken));
    message->image_placeholder = message->image_token[0] != '\0';
    message->image_requested = false;
    message->image_failed = false;
    message->image_bitmap = NULL;
    if (index + 1 > s_message_count) {
      s_message_count = index + 1;
    }
    if (s_view_state == ViewStateChat && s_messages_root) {
      render_messages();
      layer_mark_dirty(s_messages_root);
    }
    if (s_message_count >= s_expected_rows) {
      if (s_loading_older_messages) {
        // Keep the current visible selection stable until messages_done can
        // remap it by message id after the older rows have been prepended.
      } else if (!s_user_scrolled_messages) {
        s_selected_message = s_loading_older_messages && s_message_count > 0 ? 0 : s_message_count;
      } else if (s_selected_message < 0 || s_selected_message >= s_message_count) {
        s_selected_message = s_message_count > 0 ? s_message_count - 1 : s_message_count;
      }
      APP_LOG(APP_LOG_LEVEL_INFO, "Loaded %d messages", s_message_count);
      if (!s_chat_view_pending) {
        s_chat_view_pending = true;
        app_timer_register(1, show_chat_view_timer, NULL);
      }
      request_next_image();
    }
    return;
  }

  if (strcmp(type, "image_start") == 0) {
    char *message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
    int image_size = tuple_int(iter, MESSAGE_KEY_ImageSize, 0);
    if (!message_id || image_size <= 0 || image_size > MAX_IMAGE_BYTES) {
      Message *message = find_message_by_image_token(message_id);
      if (message) {
        message->image_failed = true;
        if (s_messages_root) {
          layer_mark_dirty(s_messages_root);
        }
      }
      request_next_image();
      return;
    }
    copy_cstr(s_image_message_id, sizeof(s_image_message_id), message_id);
    s_image_size = image_size;
    s_image_received = 0;
    return;
  }

  if (strcmp(type, "image") == 0) {
    char *message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
    int offset = tuple_int(iter, MESSAGE_KEY_Index, -1);
    Tuple *data = dict_find(iter, MESSAGE_KEY_ImageData);
    if (!message_id || strcmp(message_id, s_image_message_id) != 0 || !data ||
        offset < 0 || offset + data->length > MAX_IMAGE_BYTES || offset + data->length > s_image_size) {
      return;
    }
    memcpy(s_image_buffer + offset, data->value->data, data->length);
    s_image_received = PG_MAX(s_image_received, offset + data->length);
    return;
  }

  if (strcmp(type, "image_done") == 0) {
    char *message_id = tuple_cstring(iter, MESSAGE_KEY_MessageId);
    Message *message = find_message_by_image_token(message_id);
    if (message && strcmp(message_id, s_image_message_id) == 0 && s_image_received >= s_image_size) {
      message->image_bitmap = gbitmap_create_from_png_data(s_image_buffer, s_image_size);
      if (message->image_bitmap) {
        s_loaded_image_count++;
      } else {
        message->image_failed = true;
      }
      if (s_messages_root) {
        recalc_message_layout();
        layer_mark_dirty(s_messages_root);
      }
    } else if (message) {
      message->image_failed = true;
      if (s_messages_root) {
        layer_mark_dirty(s_messages_root);
      }
    }
    s_image_size = 0;
    s_image_received = 0;
    s_image_message_id[0] = '\0';
    request_next_image();
    return;
  }

  if (strcmp(type, "image_error") == 0) {
    Message *message = find_message_by_image_token(tuple_cstring(iter, MESSAGE_KEY_MessageId));
    if (message) {
      message->image_failed = true;
    }
    if (s_messages_root) {
      layer_mark_dirty(s_messages_root);
    }
    request_next_image();
    return;
  }

  if (strcmp(type, "sent") == 0 || strcmp(type, "deleted") == 0) {
    request_messages(s_current_chat_id);
  }
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  show_status("Message dropped");
}

static void outbox_failed_callback(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  show_status("Send failed");
}

static void close_action_window(void) {
  if (s_action_window) {
    window_stack_remove(s_action_window, true);
    s_action_window = NULL;
  }
}

static int action_item_count(void) {
  switch (s_action_mode) {
    case ActionMenuMain:
      if (!has_selected_message()) {
        return 3;
      }
      return selected_message_is_truncated() ? 5 : 4;
    case ActionMenuCanned:
      return MAX_CANNED;
    case ActionMenuConfirm:
      return 2;
    case ActionMenuFullText:
      return 0;
  }
  return 0;
}

static ActionItem action_item_at(int index) {
  if (!has_selected_message()) {
    static const ActionItem compose_items[] = {
      ActionItemCompose,
      ActionItemCanned,
      ActionItemRefresh
    };
    return compose_items[index];
  }

  static const ActionItem selected_items[] = {
    ActionItemCompose,
    ActionItemCanned,
    ActionItemDelete,
    ActionItemFullText,
    ActionItemRefresh
  };
  if (!selected_message_is_truncated() && index >= 3) {
    index++;
  }
  return selected_items[index];
}

static const char *action_item_title(int index) {
  static const char *confirm_items[] = {
    "Send",
    "Cancel"
  };

  if (s_action_mode == ActionMenuMain) {
    ActionItem item = action_item_at(index);
    switch (item) {
      case ActionItemCompose:
        return has_selected_message() ? "Dictate Reply" : "New Message";
      case ActionItemCanned:
        return has_selected_message() ? "Canned Reply" : "Canned Message";
      case ActionItemDelete:
        return "Delete Message";
      case ActionItemFullText:
        return "View Full Message";
      case ActionItemRefresh:
        return "Refresh";
    }
  }
  if (s_action_mode == ActionMenuCanned) {
    return s_canned[index];
  }
  return confirm_items[index];
}

// Custom action sheet instead of ActionMenu: it keeps behavior identical across
// the SDK targets this app supports.
static void action_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, ACTION_BG);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  int rail_w = ROUND_UI ? 0 : 12;
  int content_x = ROUND_UI ? 28 : rail_w;
  int content_w = bounds.size.w - content_x - (ROUND_UI ? 24 : 0);
  graphics_context_set_fill_color(ctx, APP_COLOR);
  if (ROUND_UI) {
    graphics_fill_rect(ctx, GRect(0, 0, 12, bounds.size.h), 0, GCornerNone);
  } else {
    graphics_fill_rect(ctx, GRect(0, 0, rail_w, bounds.size.h), 0, GCornerNone);
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_circle(ctx, GPoint(rail_w / 2, 8), 2);
  }

  int count = action_item_count();
  int row_h = ROUND_UI ? 30 : 32;
  int top = PG_MAX(0, (bounds.size.h - (count * row_h)) / 2);

  if (s_action_mode == ActionMenuConfirm) {
    graphics_context_set_text_color(ctx, ACTION_TEXT);
    graphics_draw_text(ctx, s_pending_text, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                       GRect(content_x + 6, 10, content_w - 12, 70),
                       GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
    top = bounds.size.h - (count * row_h) - 8;
  }

  if (s_action_mode == ActionMenuFullText) {
    const char *text = "";
    if (s_selected_message >= 0 && s_selected_message < s_message_count) {
      text = s_messages[s_selected_message].text;
    }
    GFont full_font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
    int text_w = content_w - 12;
    GSize text_size = graphics_text_layout_get_content_size(
      text, full_font, GRect(0, 0, text_w, 2000),
      GTextOverflowModeWordWrap, GTextAlignmentLeft
    );
    s_full_text_height = text_size.h + 20;
    int max_scroll = PG_MAX(0, s_full_text_height - bounds.size.h + 8);
    s_full_text_scroll_offset = PG_MIN(s_full_text_scroll_offset, max_scroll);

    graphics_context_set_text_color(ctx, ACTION_TEXT_SELECTED);
    graphics_draw_text(ctx, text, full_font,
                       GRect(content_x + 6, 8 - s_full_text_scroll_offset, text_w, s_full_text_height),
                       GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
    return;
  }

  for (int i = 0; i < count; i++) {
    GRect row = GRect(content_x, top + (i * row_h), content_w, row_h);
    bool selected = i == s_action_selected;

    graphics_context_set_text_color(ctx, selected ? ACTION_TEXT_SELECTED : ACTION_TEXT);
    graphics_draw_text(ctx, action_item_title(i), fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(row.origin.x + 4, row.origin.y + 4, row.size.w - 8, row.size.h - 5),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }
}

static void show_action_window(ActionMenuMode mode) {
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
  layer_set_update_proc(s_action_layer, action_layer_update_proc);
  layer_add_child(window_layer, s_action_layer);

  window_stack_push(s_action_window, true);
}

static void dictation_callback(DictationSession *session, DictationSessionStatus status,
                               char *transcription, void *context) {
  if (status == DictationSessionStatusSuccess && transcription) {
    copy_cstr(s_pending_text, sizeof(s_pending_text), transcription);
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
  window_destroy(window);
  if (s_action_window == window) {
    s_action_window = NULL;
  }
}

static void action_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  int selected = s_action_selected;

  if (s_action_mode == ActionMenuMain) {
    ActionItem item = action_item_at(selected);
    switch (item) {
      case ActionItemCompose:
        close_action_window();
        start_dictation();
        break;
      case ActionItemCanned:
        s_action_mode = ActionMenuCanned;
        s_action_selected = 0;
        layer_mark_dirty(s_action_layer);
        break;
      case ActionItemDelete:
        close_action_window();
        delete_selected_message();
        break;
      case ActionItemFullText:
        s_action_mode = ActionMenuFullText;
        s_full_text_scroll_offset = 0;
        layer_mark_dirty(s_action_layer);
        break;
      case ActionItemRefresh:
        close_action_window();
        request_messages(s_current_chat_id);
        break;
    }
    return;
  }

  if (s_action_mode == ActionMenuCanned) {
    copy_cstr(s_pending_text, sizeof(s_pending_text), s_canned[selected]);
    s_action_mode = ActionMenuConfirm;
    s_action_selected = 0;
    layer_mark_dirty(s_action_layer);
    return;
  }

  if (s_action_mode == ActionMenuConfirm) {
    close_action_window();
    if (selected == 0) {
      send_text_message(s_pending_text, has_selected_message());
    }
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
  if (s_action_mode == ActionMenuCanned || s_action_mode == ActionMenuConfirm ||
      s_action_mode == ActionMenuFullText) {
    s_action_mode = ActionMenuMain;
    s_action_selected = 0;
    layer_mark_dirty(s_action_layer);
  } else {
    close_action_window();
  }
}

static void action_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, action_select_click_handler);
  window_single_click_subscribe(BUTTON_ID_UP, action_up_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, action_down_click_handler);
  window_single_click_subscribe(BUTTON_ID_BACK, action_back_click_handler);
}

static void main_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view_state == ViewStateChat) {
    show_action_window(ActionMenuMain);
  } else if (s_view_state == ViewStateChatList && s_chat_menu) {
    MenuIndex index = menu_layer_get_selected_index(s_chat_menu);
    chat_menu_select_callback(s_chat_menu, &index, NULL);
  }
}

static void main_up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view_state == ViewStateChatList && s_chat_menu) {
    menu_layer_set_selected_next(s_chat_menu, true, MenuRowAlignCenter, true);
    return;
  }
  if (s_view_state != ViewStateChat || !s_messages_root || s_message_count == 0) {
    return;
  }
  s_user_scrolled_messages = true;
  recalc_message_layout();

  if (compose_target_is_selected() || s_selected_message < 0) {
    select_message_with_alignment(s_message_count - 1, true, true);
    return;
  }

  GRect bounds = layer_get_bounds(s_messages_root);
  int margin = 6;
  int top = s_message_y[s_selected_message] - margin;
  if (s_message_h[s_selected_message] > bounds.size.h - (margin * 2) &&
      s_chat_scroll_offset > top) {
    set_chat_scroll_offset(PG_MAX(top, s_chat_scroll_offset - CHAT_SCROLL_DELTA), true);
    return;
  }
  if (s_selected_message > 0) {
    select_message_with_alignment(s_selected_message - 1, true, true);
    if (s_selected_message <= 1) {
      request_older_messages(false, true);
    }
  } else {
    request_older_messages(true, false);
  }
}

static void main_down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view_state == ViewStateChatList && s_chat_menu) {
    menu_layer_set_selected_next(s_chat_menu, false, MenuRowAlignCenter, true);
    return;
  }
  if (s_view_state != ViewStateChat || !s_messages_root || s_message_count == 0) {
    return;
  }
  s_user_scrolled_messages = true;
  recalc_message_layout();

  if (compose_target_is_selected() || s_selected_message < 0) {
    scroll_to_bottom(true);
    return;
  }

  GRect bounds = layer_get_bounds(s_messages_root);
  int margin = 6;
  int bottom = s_message_y[s_selected_message] + s_message_h[s_selected_message] + margin;
  if (s_message_h[s_selected_message] > bounds.size.h - (margin * 2) &&
      s_chat_scroll_offset + bounds.size.h < bottom) {
    set_chat_scroll_offset(PG_MIN(bottom - bounds.size.h, s_chat_scroll_offset + CHAT_SCROLL_DELTA), true);
    return;
  }
  if (s_selected_message < s_message_count - 1) {
    select_message_with_alignment(s_selected_message + 1, false, true);
  } else {
    scroll_to_bottom(true);
  }
}

static void main_back_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_view_state == ViewStateChat) {
    render_chat_list();
  } else {
    window_stack_pop(true);
  }
}

static void click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, main_select_click_handler);
  window_single_click_subscribe(BUTTON_ID_UP, main_up_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, main_down_click_handler);
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
  destroy_chat_view();
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

static void init(void) {
  s_view_state = ViewStateLoading;
  s_selected_message = -1;

  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_open(APP_INBOX_SIZE, APP_OUTBOX_SIZE);

  s_main_window = window_create();
  window_set_click_config_provider(s_main_window, click_config_provider);
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .unload = main_window_unload
  });
  window_stack_push(s_main_window, true);
}

static void deinit(void) {
  destroy_message_images();
  if (s_dictation_session) {
    dictation_session_destroy(s_dictation_session);
  }
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
