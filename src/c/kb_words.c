#include "kb_words.h"

#if defined(PBL_PLATFORM_EMERY) || defined(PBL_PLATFORM_GABBRO)

#include <pebble.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// Dictionary layout: see tools/build-kb-words.py. Buckets are (first letter, second-char slot),
// 26 * 28 of them, each sorted and prefix-shared. Everything is streamed from the resource in
// small chunks, so the idle footprint is two words and each call uses one small heap block.

#define NBUCK 728
#define IDX_BASE 4
#define MAX_RESULTS 12
#define RD_BUF 256
#define SW_PRELIM 24
#define SW_MAXKEYS 40
#define SW_MAXPATH 64

static ResHandle s_res;
static int8_t s_state;  // 0 = not checked, 1 = usable, -1 = missing or bad

// ---- keyboard geometry (QWERTY, units of 1/16 key) ----

static const char QWERTY[] = "qwertyuiopasdfghjklzxcvbnm";
static const uint8_t QIDX[26] = {10, 23, 21, 12, 2, 13, 14, 15, 7, 16, 17, 18, 25,
                                 24, 8, 9, 0, 3, 11, 4, 6, 22, 1, 20, 5, 19};

static void key_center(char c, int *x, int *y) {
  int i = QIDX[c - 'a'];
  int x2, row;
  if (i < 10) { row = 0; x2 = 2 * i; }
  else if (i < 19) { row = 1; x2 = 1 + 2 * (i - 10); }
  else { row = 2; x2 = 3 + 2 * (i - 19); }
  *x = x2 * 8 + 8;
  *y = row * 16 + 8;
}

static bool keys_adjacent(char a, char b) {
  if (a < 'a' || a > 'z' || b < 'a' || b > 'z') return false;
  int ax, ay, bx, by;
  key_center(a, &ax, &ay);
  key_center(b, &bx, &by);
  int dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy < 656;  // within 1.6 keys
}

static char key_at(int x, int y) {
  int row = y < 0 ? 0 : (y >> 4);
  if (row > 2) row = 2;
  int off = row == 0 ? 0 : (row == 1 ? 8 : 24);
  int maxc = row == 0 ? 9 : (row == 1 ? 8 : 6);
  int col = x - off < 0 ? 0 : (x - off) >> 4;
  if (col > maxc) col = maxc;
  return QWERTY[(row == 0 ? 0 : (row == 1 ? 10 : 19)) + col];
}

// Keys a straight finger path over the letters of `l` crosses, consecutive duplicates removed.
static int ideal_path(const char *l, int m, char *out, int cap) {
  int n = 0;
  int px, py;
  key_center(l[0], &px, &py);
  out[n++] = l[0];
  for (int i = 1; i < m; i++) {
    int qx, qy;
    key_center(l[i], &qx, &qy);
    int dx = qx - px, dy = qy - py;
    int steps = (abs(dx) > abs(dy) ? abs(dx) : abs(dy)) / 3 + 1;
    for (int s = 1; s <= steps; s++) {
      char k = key_at(px + dx * s / steps, py + dy * s / steps);
      if (k != out[n - 1] && n < cap) out[n++] = k;
    }
    px = qx;
    py = qy;
  }
  return n;
}

// ---- resource access ----

typedef struct {
  uint32_t pos, end;
  uint16_t bp, bl;
  uint8_t buf[RD_BUF];
} Rd;

typedef struct {
  char w[KB_WORD_MAX + 1];
  uint8_t len, fq;
} Ent;

static bool dict_ready(void) {
  if (s_state == 0) {
    uint8_t m[4];
    s_res = resource_get_handle(RESOURCE_ID_KB_WORDS);
    s_state = (s_res && resource_load_byte_range(s_res, 0, m, 4) == 4 &&
               m[0] == 'K' && m[1] == 'B' && m[2] == 'W' && m[3] == '1') ? 1 : -1;
  }
  return s_state > 0;
}

static bool idx_get(int i, uint32_t *v) {
  uint8_t b[4];
  if (resource_load_byte_range(s_res, IDX_BASE + 4 * i, b, 4) != 4) return false;
  *v = b[0] | (b[1] << 8) | (b[2] << 16) | ((uint32_t)b[3] << 24);
  return true;
}

// Open a reader over buckets [first, last) .
static bool rd_open(Rd *r, int first, int last) {
  uint32_t a, b;
  if (!idx_get(first, &a) || !idx_get(last, &b)) return false;
  r->pos = a;
  r->end = b;
  r->bp = r->bl = 0;
  return a < b;
}

static int rd_byte(Rd *r) {
  if (r->bp >= r->bl) {
    if (r->pos >= r->end) return -1;
    uint32_t n = r->end - r->pos;
    if (n > RD_BUF) n = RD_BUF;
    size_t got = resource_load_byte_range(s_res, r->pos, r->buf, n);
    if (got == 0) return -1;
    r->pos += got;
    r->bl = (uint16_t)got;
    r->bp = 0;
  }
  return r->buf[r->bp++];
}

static bool rd_next(Rd *r, Ent *e) {
  int s = rd_byte(r);
  if (s < 0 || s > e->len) return false;
  int len = s;
  for (;;) {
    int c = rd_byte(r);
    if (c < 0 || len >= KB_WORD_MAX - 1) return false;
    e->w[len++] = (char)(c & 0x7f);
    if (c & 0x80) break;
  }
  int f = rd_byte(r);
  if (f < 0) return false;
  e->w[len] = 0;
  e->len = (uint8_t)len;
  e->fq = (uint8_t)f;
  return true;
}

static int slot_of(const char *w) {  // second-char slot of a word/prefix, -1 if invalid
  char c = w[1];
  if (c == 0) return 0;
  if (c == '\'') return 1;
  if (c >= 'a' && c <= 'z') return 2 + (c - 'a');
  return -1;
}

static bool valid_chars(const char *w, int len) {
  for (int i = 0; i < len; i++) {
    char c = w[i];
    if (!((c >= 'a' && c <= 'z') || (c == '\'' && i > 0))) return false;
  }
  return true;
}

static bool open_first_letter(Rd *r, char c) {
  return rd_open(r, (c - 'a') * 28, (c - 'a' + 1) * 28);
}

// ---- ranked short lists ----

typedef struct {
  char w[KB_WORD_MAX];
  int16_t s;
  uint8_t fq;
} Item;

static void list_add(Item *t, int *n, int cap, const char *w, int s, int fq) {
  if (*n == cap && s <= t[cap - 1].s) return;
  int i = *n < cap ? (*n)++ : cap - 1;
  while (i > 0 && t[i - 1].s < s) {
    t[i] = t[i - 1];
    i--;
  }
  strncpy(t[i].w, w, KB_WORD_MAX - 1);
  t[i].w[KB_WORD_MAX - 1] = 0;
  t[i].s = (int16_t)s;
  t[i].fq = (uint8_t)fq;
}

// ---- public API ----

void kb_words_init(void) {
  s_state = 0;
  s_res = NULL;
}

void kb_words_deinit(void) {
  s_state = 0;
  s_res = NULL;
}

static const char *const STARTERS[] = {"i", "the", "you", "it", "we", "to", "and", "a", "my", "so", "ok", "thanks"};

typedef struct {
  Rd rd;
  Ent e;
  Item top[MAX_RESULTS];
} CompleteCtx;

int kb_words_complete(const char *prefix, char out[][KB_WORD_MAX], int max) {
  if (!prefix || !out || max <= 0) return 0;
  if (max > MAX_RESULTS) max = MAX_RESULTS;
  int plen = (int)strlen(prefix);
  if (plen == 0) {
    int n = (int)(sizeof STARTERS / sizeof *STARTERS);
    if (n > max) n = max;
    for (int i = 0; i < n; i++) strcpy(out[i], STARTERS[i]);
    return n;
  }
  if (plen >= KB_WORD_MAX - 1 || !valid_chars(prefix, plen) || !dict_ready()) return 0;
  CompleteCtx *c = malloc(sizeof *c);
  if (!c) return 0;
  int n = 0;
  int first = (prefix[0] - 'a') * 28;
  bool ok;
  if (plen == 1) {
    ok = rd_open(&c->rd, first, first + 28);
  } else {
    int sl = slot_of(prefix);
    ok = sl >= 0 && rd_open(&c->rd, first + sl, first + sl + 1);
  }
  if (ok) {
    c->e.len = 0;
    while (rd_next(&c->rd, &c->e)) {
      int m = c->e.len < plen ? c->e.len : plen;
      int cmp = memcmp(c->e.w, prefix, m);
      if (cmp > 0) break;
      if (cmp < 0 || c->e.len <= plen || c->e.fq == 0) continue;
      list_add(c->top, &n, max, c->e.w, c->e.fq * 16 - c->e.len, c->e.fq);
    }
  }
  for (int i = 0; i < n; i++) strcpy(out[i], c->top[i].w);
  free(c);
  return n;
}

// Exact lookup. Returns frequency (0 = known but never suggested) or -1 if absent.
static int lookup(Rd *rd, Ent *e, const char *w, int len) {
  int sl = slot_of(w);
  if (sl < 0) return -1;
  int b = (w[0] - 'a') * 28 + sl;
  if (!rd_open(rd, b, b + 1)) return -1;
  e->len = 0;
  while (rd_next(rd, e)) {
    int cmp = strcmp(e->w, w);
    if (cmp == 0) return e->fq;
    if (cmp > 0) break;
  }
  (void)len;
  return -1;
}

// Cost (tenths of an edit) of the typed word missing dictionary char b[k], or having extra char a[k].
static int ins_cost(const char *b, int lb, int k) {
  if (b[k] == '\'') return 1;
  if ((k > 0 && b[k - 1] == b[k]) || (k + 1 < lb && b[k + 1] == b[k])) return 5;
  return 10;
}

static int del_cost(const char *a, int la, int k) {
  return ((k > 0 && a[k - 1] == a[k]) || (k + 1 < la && a[k + 1] == a[k])) ? 5 : 10;
}

// Weighted Damerau-Levenshtein (costs in tenths of an edit): typed `a` -> dictionary word `b`.
// Returns a value > limit when it exceeds it.
static int edit_cost(const char *a, int la, const char *b, int lb, int limit) {
  uint8_t rows[3][KB_WORD_MAX + 1];
  uint8_t *p2 = rows[0], *p1 = rows[1], *cur = rows[2];
  for (int j = 0; j <= lb; j++) {
    int c = 0;
    for (int k = 0; k < j; k++) c += ins_cost(b, lb, k);
    p1[j] = (uint8_t)(c > 250 ? 250 : c);
  }
  for (int i = 1; i <= la; i++) {
    cur[0] = (uint8_t)(p1[0] + del_cost(a, la, i - 1));
    int rmin = cur[0];
    for (int j = 1; j <= lb; j++) {
      int sub = a[i - 1] == b[j - 1] ? 0 : (keys_adjacent(a[i - 1], b[j - 1]) ? 6 : 10);
      int v = p1[j - 1] + sub;
      int d = p1[j] + del_cost(a, la, i - 1);
      if (d < v) v = d;
      int ins = cur[j - 1] + ins_cost(b, lb, j - 1);
      if (ins < v) v = ins;
      if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) {
        int t = p2[j - 2] + 8;
        if (t < v) v = t;
      }
      if (v > 250) v = 250;
      cur[j] = (uint8_t)v;
      if (v < rmin) rmin = v;
    }
    if (rmin > limit) return 250;
    uint8_t *tmp = p2;
    p2 = p1;
    p1 = cur;
    cur = tmp;
  }
  return p1[lb];
}

typedef struct {
  Rd rd;
  Ent e;
} CorrectCtx;

bool kb_words_correct(const char *word, char *out, size_t out_size) {
  if (!word || !out || out_size == 0) return false;
  int la = (int)strlen(word);
  if (la < 2 || la >= KB_WORD_MAX - 2 || !valid_chars(word, la) || strchr(word, '\'') || !dict_ready()) return false;
  CorrectCtx *c = malloc(sizeof *c);
  if (!c) return false;
  bool result = false;
  if (lookup(&c->rd, &c->e, word, la) < 0) {
    int limit = la >= 8 ? 20 : 10;
    int maxdiff = la >= 8 ? 2 : 1;
    int best = -9999, second = -9999, bestfq = 0;
    char bw[KB_WORD_MAX] = "";
    // Same first letter; plus the bucket of a transposed first pair ("hte" -> "the").
    for (int pass = 0; pass < 2; pass++) {
      bool ok;
      if (pass == 0) {
        ok = open_first_letter(&c->rd, word[0]);
      } else {
        char sw[3] = {word[1], word[0], 0};
        int sl = slot_of(sw);
        ok = word[0] != word[1] && sl >= 0 && rd_open(&c->rd, (sw[0] - 'a') * 28 + sl, (sw[0] - 'a') * 28 + sl + 1);
      }
      if (!ok) continue;
      c->e.len = 0;
      while (rd_next(&c->rd, &c->e)) {
        int diff = c->e.len - la;
        if (c->e.fq == 0 || diff > maxdiff || diff < -maxdiff) continue;
        int cost = edit_cost(word, la, c->e.w, c->e.len, limit);
        if (cost > limit || (la <= 2 && cost > 5) || (la == 3 && cost > 8)) continue;
        // A missing apostrophe (dont -> don't) is as good as certain: those typos are not in the list.
        int score = (int)c->e.fq - cost * 4 + (cost <= 2 ? 1000 : 0);
        if (score > best) {
          second = best;
          best = score;
          bestfq = c->e.fq;
          strcpy(bw, c->e.w);
        } else if (score > second) {
          second = score;
        }
      }
    }
    if (best > -9999 && bestfq >= 90 && best - second >= 20 && strlen(bw) < out_size) {
      strcpy(out, bw);
      result = true;
    }
  }
  free(c);
  return result;
}

typedef struct {
  Rd rd;
  Ent e;
  Item top[SW_PRELIM];
  char path[SW_MAXPATH];
} SwipeCtx;

#define SW_MISS 10
#define SW_END 40

// A word that starts and ends exactly on the keys where the finger went down and up is far
// more likely than one that only starts or ends on a neighbouring key.
static int ends_bonus(char wf, char wl, char kf, char kl) {
  return (wf == kf ? SW_END : 0) + (wl == kl ? SW_END : 0);
}

static uint32_t key_mask(char k) {
  uint32_t m = 1u << (k - 'a');
  for (char c = 'a'; c <= 'z'; c++)
    if (keys_adjacent(k, c)) m |= 1u << (c - 'a');
  return m;
}

// Number of keys in common (longest common subsequence) of two short key strings.
static int lcs(const char *a, int la, const char *b, int lb) {
  uint8_t row[SW_MAXPATH + 1];
  memset(row, 0, (size_t)lb + 1);
  for (int i = 0; i < la; i++) {
    int diag = 0;
    for (int j = 0; j < lb; j++) {
      int up = row[j + 1];
      row[j + 1] = a[i] == b[j] ? (uint8_t)(diag + 1) : (up > row[j] ? (uint8_t)up : row[j]);
      diag = up;
    }
  }
  return row[lb];
}

int kb_words_swipe(const char *keys, char out[][KB_WORD_MAX], int max) {
  if (!keys || !out || max <= 0) return 0;
  if (max > MAX_RESULTS) max = MAX_RESULTS;
  int n = (int)strlen(keys);
  if (n < 2 || n > SW_MAXKEYS || !dict_ready()) return 0;
  for (int i = 0; i < n; i++)
    if (keys[i] < 'a' || keys[i] > 'z') return 0;
  SwipeCtx *c = malloc(sizeof *c);
  if (!c) return 0;
  uint32_t fm = key_mask(keys[0]), lm = key_mask(keys[n - 1]);
  int np = 0;
  for (char f = 'a'; f <= 'z'; f++) {
    if (!(fm & (1u << (f - 'a'))) || !open_first_letter(&c->rd, f)) continue;
    c->e.len = 0;
    while (rd_next(&c->rd, &c->e)) {
      if (c->e.fq == 0 || !(lm & (1u << (c->e.w[c->e.len - 1] - 'a')))) continue;
      // Letters of the word without apostrophes and doubled letters.
      char l[KB_WORD_MAX];
      int m = 0;
      for (int i = 0; i < c->e.len; i++) {
        char ch = c->e.w[i];
        if (ch == '\'' || (m > 0 && l[m - 1] == ch)) continue;
        l[m++] = ch;
      }
      if (m < 2 || m > n || !(lm & (1u << (l[m - 1] - 'a')))) continue;
      int ti = 1;
      bool ok = true;
      for (int k = 1; k < m - 1 && ok; k++) {
        while (ti < n - 1 && keys[ti] != l[k]) ti++;
        if (ti >= n - 1) ok = false;
        ti++;
      }
      if (!ok) continue;
      list_add(c->top, &np, SW_PRELIM, c->e.w,
               c->e.fq - 5 * (n - m) + ends_bonus(l[0], l[m - 1], keys[0], keys[n - 1]), c->e.fq);
    }
  }
  // Re-rank the survivors by how well each word's ideal finger path explains the trace.
  for (int i = 0; i < np; i++) {
    char l[KB_WORD_MAX];
    int m = 0;
    for (const char *p = c->top[i].w; *p; p++)
      if (*p != '\'' && (m == 0 || l[m - 1] != *p)) l[m++] = *p;
    if (m == 0) { c->top[i].s = -9999; continue; }
    int pl = ideal_path(l, m, c->path, SW_MAXPATH);
    int common = lcs(keys, n, c->path, pl);
    int fq = c->top[i].fq;
    c->top[i].s = (int16_t)(fq - SW_MISS * (n - common) - SW_MISS * (pl - common) +
                            ends_bonus(l[0], l[m - 1], keys[0], keys[n - 1]));
  }
  // np is small: insertion sort by the new score.
  for (int i = 1; i < np; i++) {
    Item t = c->top[i];
    int j = i;
    while (j > 0 && c->top[j - 1].s < t.s) {
      c->top[j] = c->top[j - 1];
      j--;
    }
    c->top[j] = t;
  }
  if (np > max) np = max;
  for (int i = 0; i < np; i++) strcpy(out[i], c->top[i].w);
  free(c);
  return np;
}

#endif  // emery || gabbro
