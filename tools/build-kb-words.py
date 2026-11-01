#!/usr/bin/env python3
"""Build resources/data/kb_words.bin, the on-watch word list for the Pebblegram keyboard.

Source and licence
  Word list and frequencies: the Python package `wordfreq` 3.x (pip install wordfreq),
  English ("en") list. Code Apache-2.0; data CC BY-SA 4.0 (Robyn Speer et al.,
  https://github.com/rspeer/wordfreq, built from Exquisite Corpus: Wikipedia, subtitles,
  news, books, web text, Twitter, Reddit, Google Books ngrams).
  The profanity list below is our own.

Usage:  pip install wordfreq && python3 tools/build-kb-words.py [out.bin] [num_words]

Binary format (little endian), read on the watch with resource_load_byte_range():
  0   4   magic "KBW1"
  4   4*(26*28+1)   index: absolute offset of each bucket, then the end offset
                   bucket = first letter (0..25) * 28 + slot, where slot is
                   0 = word has only one letter, 1 = second char is an apostrophe,
                   2..27 = second letter a..z.
  ... body: buckets in order. Within a bucket words are sorted and prefix-shared; the first
            word of every bucket has no shared prefix. Entry:
              u8  number of leading chars shared with the previous word in the bucket
              suffix chars (ASCII, apostrophe allowed), last char has bit 0x80 set
              u8  frequency 1..255 (log scale, about 40 steps per power of ten),
                  or 0 = known word that must never be suggested (profanity)
"""
import re
import struct
import sys

from wordfreq import top_n_list, zipf_frequency

OUT = sys.argv[1] if len(sys.argv) > 1 else "resources/data/kb_words.bin"
TARGET = int(sys.argv[2]) if len(sys.argv) > 2 else 22000
MAXLEN = 20

TWO = set("of to in is it on be as at so we he by or my up do no if me us am an go oh ok hi ah ha uh um yo".split())
NOVOWEL_OK = set("hmm brb btw pls thx tbh nth shh psst tv pm cv mph".split())
CONTR_SUFFIX = ("n't", "'m", "'re", "'ve", "'ll", "'d")
CONTR_S = set("it's he's she's that's there's here's what's who's let's where's how's when's why's".split())
EXTRA_APOS = {"o'clock", "ma'am", "y'all"}
# Words that are really apostrophe-less typos of contractions: they must NOT be in the
# dictionary so that autocorrect turns "dont" into "don't" and "im" into "i'm".
# (ill, id, hell, shell, well, were, wed, its, lets, hes, shed are real words and stay.)
NOAPOS = set("""dont im cant wont ive youre theyre isnt doesnt didnt wasnt couldnt wouldnt shouldnt
arent hasnt havent hadnt werent thats whats theres heres wouldve couldve shouldve youve weve theyve
youll theyll hed shes whos aint mustnt neednt mightnt didn doesn isn wasn aren couldn wouldn shouldn
haven hadn hasn weren""".split())
MISSPELLED = set("""definately seperate occured untill alot accomodate tomorow tommorow tommorrow goverment enviroment
adress begining calender comming commited embarass existance greatful happend immediatly independant knowlege
neccessary noticable occurance occassion posession prefered probly publically realy refered relevent restaraunt
rythm succesful suprise truely unfortunatly vaccum wich thanx thankyou teh hte adn taht waht yuo jsut wiht abotu thier recieve beleive freind wierd becuase""".split())
BAD = set("""fuck fucks fucked fucker fuckers fucking fuckin motherfucker motherfucking shit shits shitty shitting
bullshit shite cunt cunts bitch bitches bitchy bastard bastards asshole assholes arse arsehole ass asses
dick dicks dickhead cock cocks cocksucker pussy pussies whore whores slut sluts slutty nigger niggers nigga niggas
faggot faggots fag fags dyke dykes retard retarded retards twat twats wank wanker prick pricks tits titty
porn porno pornography penis vagina dildo cum cums jizz blowjob handjob anal anus orgasm masturbate
masturbation rape raped rapist rapes pedo pedophile chink kike spic spics coon gook paki wetback tranny
horny bollocks bugger damnit goddamn goddamned wtf stfu piss pissed pisses pissing crap crappy
screwed boner nipple nipples sex sexy sexual naked nude nudes""".split())
# Of the above, merely mild or common ones are still suggested; the rest get frequency 0.
SUGGEST_OK = set("crap crappy sex sexual naked nude wtf".split())


def shape_ok(w):
    if not (1 <= len(w) <= MAXLEN):
        return False
    if re.search(r"(.)\1\1", w):
        return False
    if "'" in w:
        if not re.fullmatch(r"[a-z]+'[a-z]+", w):
            return False
        return w.endswith(CONTR_SUFFIX) or w in CONTR_S or w in EXTRA_APOS
    if not re.fullmatch(r"[a-z]+", w):
        return False
    if len(w) == 1:
        return w in ("a", "i")
    if len(w) == 2:
        return w in TWO
    if not re.search(r"[aeiouy]", w) and w not in NOVOWEL_OK:
        return False
    if w in NOAPOS:
        return False
    return True


def edits1(w):
    letters = "abcdefghijklmnopqrstuvwxyz"
    out = set()
    for i in range(len(w)):
        out.add(w[:i] + w[i + 1:])
        for c in letters:
            out.add(w[:i] + c + w[i + 1:])
    for i in range(len(w) - 1):
        out.add(w[:i] + w[i + 1] + w[i] + w[i + 2:])
    for i in range(len(w) + 1):
        for c in letters:
            out.add(w[:i] + c + w[i:])
    out.discard(w)
    return out


def main():
    pool = [str(w) for w in top_n_list("en", 80000)]
    cand = []
    seen = set()
    for w in pool:
        if w in seen or not shape_ok(w):
            continue
        seen.add(w)
        z = zipf_frequency(w, "en")
        # Foreign words that leaked into the English corpus: much more common in another language.
        if len(cand) > 6000:
            zo = max(zipf_frequency(w, l) for l in ("de", "fr", "es", "it", "pt", "nl"))
            if zo > z + 0.8:
                continue
        cand.append((w, z))
    zmap = dict(cand)

    # Drop probable typos: a rare word that is a transposition of a far more common one
    # ("recieve", "teh"), plus a list of well-known misspellings.
    kept = []
    dropped = []
    for w, z in cand:
        if w in MISSPELLED or (z < 4.6 and len(w) >= 6 and "'" not in w and any(
                zmap.get(w[:i] + w[i + 1] + w[i] + w[i + 2:], 0) >= z + 1.5
                for i in range(len(w) - 1) if w[i] != w[i + 1])):
            dropped.append(w)
            continue
        kept.append((w, z))
    kept = kept[:TARGET]
    print("dropped as typos:", len(dropped), " ".join(dropped[:60]), file=sys.stderr)

    entries = []
    for w, z in kept:
        q = max(1, min(255, round((z - 2.0) * 40) + 1))
        if w in BAD and w not in SUGGEST_OK:
            q = 0
        entries.append((w, q))
    entries.sort()

    def slot(w):
        if len(w) == 1:
            return 0
        return 1 if w[1] == "'" else ord(w[1]) - 97 + 2

    buckets = [[] for _ in range(26 * 28)]
    for w, q in entries:
        buckets[(ord(w[0]) - 97) * 28 + slot(w)].append((w, q))

    body = bytearray()
    offs = []
    for b in buckets:
        offs.append(len(body))
        prev = ""
        for w, q in b:
            s = 0
            while s < len(prev) and s < len(w) and prev[s] == w[s]:
                s += 1
            if s == len(w):  # a word can never be a full prefix-duplicate of the previous one
                s = len(w) - 1
            suffix = w[s:].encode()
            body.append(s)
            body += suffix[:-1] + bytes([suffix[-1] | 0x80])
            body.append(q)
            prev = w
    offs.append(len(body))
    base = 4 + 4 * len(offs)
    blob = b"KBW1" + b"".join(struct.pack("<I", base + o) for o in offs) + bytes(body)
    with open(OUT, "wb") as f:
        f.write(blob)
    print("words: %d  bytes: %d  largest bucket: %d" % (
        len(entries), len(blob), max(offs[i + 1] - offs[i] for i in range(len(offs) - 1))), file=sys.stderr)
    print("zero-freq (never suggested):", sum(1 for _, q in entries if q == 0), file=sys.stderr)


if __name__ == "__main__":
    main()
