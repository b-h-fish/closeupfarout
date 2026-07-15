#!/usr/bin/env python3
"""
Build api/books.json — the Project Gutenberg manifest for Instrument 01.

Downloads (or reuses) Gutenberg's public catalog CSV, filters to English-language
prose books, cleans up titles/authors, guarantees a set of curated classics is
present, and samples down to a manageable pool.

Run:  python3 scripts/build-gutenberg-manifest.py
Output: api/books.json   (array of { id, title, author })

The sample is seeded, so re-running produces the same manifest unless you change
TARGET or the seed.
"""

import csv
import io
import json
import os
import random
import re
import sys
import urllib.request

CATALOG_URL = "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "api", "books.json")
CACHE = os.path.join(HERE, "pg_catalog.csv")  # local scratch copy if present

TARGET = 20000      # size of the sampled pool (before adding curated classics)
SEED = 42

# Curated anchors — recognizable works we always want reachable. Merged in on top
# of the random sample so the weave always has a chance at the canon.
CURATED = [
    (11, "Alice's Adventures in Wonderland", "Lewis Carroll"),
    (23, "Narrative of the Life of Frederick Douglass", "Frederick Douglass"),
    (26, "Paradise Lost", "John Milton"),
    (35, "The Time Machine", "H.G. Wells"),
    (36, "The War of the Worlds", "H.G. Wells"),
    (43, "The Strange Case of Dr Jekyll and Mr Hyde", "Robert Louis Stevenson"),
    (76, "Adventures of Huckleberry Finn", "Mark Twain"),
    (84, "Frankenstein", "Mary Shelley"),
    (98, "A Tale of Two Cities", "Charles Dickens"),
    (103, "Around the World in Eighty Days", "Jules Verne"),
    (120, "Treasure Island", "Robert Louis Stevenson"),
    (135, "Les Misérables", "Victor Hugo"),
    (145, "Middlemarch", "George Eliot"),
    (158, "Emma", "Jane Austen"),
    (161, "Sense and Sensibility", "Jane Austen"),
    (174, "The Picture of Dorian Gray", "Oscar Wilde"),
    (205, "Walden", "Henry David Thoreau"),
    (219, "Heart of Darkness", "Joseph Conrad"),
    (345, "Dracula", "Bram Stoker"),
    (768, "Wuthering Heights", "Emily Brontë"),
    (844, "The Importance of Being Earnest", "Oscar Wilde"),
    (969, "The Tenant of Wildfell Hall", "Anne Brontë"),
    (996, "Don Quixote", "Miguel de Cervantes"),
    (1228, "On the Origin of Species", "Charles Darwin"),
    (1260, "Jane Eyre", "Charlotte Brontë"),
    (1322, "Leaves of Grass", "Walt Whitman"),
    (1342, "Pride and Prejudice", "Jane Austen"),
    (1399, "Anna Karenina", "Leo Tolstoy"),
    (1400, "Great Expectations", "Charles Dickens"),
    (1497, "The Republic", "Plato"),
    (1524, "Hamlet", "William Shakespeare"),
    (1532, "King Lear", "William Shakespeare"),
    (1533, "Macbeth", "William Shakespeare"),
    (1600, "Symposium", "Plato"),
    (1727, "The Odyssey", "Homer"),
    (1998, "Thus Spoke Zarathustra", "Friedrich Nietzsche"),
    (2554, "Crime and Punishment", "Fyodor Dostoevsky"),
    (2641, "A Room with a View", "E.M. Forster"),
    (2680, "Meditations", "Marcus Aurelius"),
    (2701, "Moby-Dick", "Herman Melville"),
    (4517, "Ethan Frome", "Edith Wharton"),
    (5200, "The Metamorphosis", "Franz Kafka"),
    (6130, "The Iliad", "Homer"),
    (8800, "The Divine Comedy", "Dante Alighieri"),
    (16643, "Essays", "Ralph Waldo Emerson"),
    (25344, "The Scarlet Letter", "Nathaniel Hawthorne"),
    (28054, "The Brothers Karamazov", "Fyodor Dostoevsky"),
]

# Titles matching these are catalog cruft, not readable prose.
TITLE_SKIP = re.compile(
    r"^(index of the project gutenberg|"
    r"the project gutenberg|"
    r"complete project gutenberg)",
    re.I,
)


def load_catalog():
    if os.path.exists(CACHE):
        print(f"Using cached catalog: {CACHE}")
        with open(CACHE, encoding="utf-8") as f:
            return list(csv.DictReader(f))
    print(f"Downloading catalog: {CATALOG_URL}")
    with urllib.request.urlopen(CATALOG_URL) as resp:
        data = resp.read().decode("utf-8")
    with open(CACHE, "w", encoding="utf-8") as f:
        f.write(data)
    return list(csv.DictReader(io.StringIO(data)))


def clean_title(raw):
    # Titles sometimes carry a subtitle after a newline — keep the main title.
    title = raw.split("\n")[0].strip()
    title = re.sub(r"\s+", " ", title)
    return title


def clean_author(raw):
    if not raw or not raw.strip():
        return None
    # Multiple authors are separated by ";" — take the first.
    first = raw.split(";")[0].strip()
    # Strip bracketed role tags like "[Translator]", "[Editor]", "[Illustrator]".
    first = re.sub(r"\[[^\]]*\]", "", first).strip()
    # Single token (e.g. "United States", "Various", "Anonymous") — leave as-is.
    if "," not in first:
        return first if first.lower() not in ("various", "anonymous", "unknown") else None
    parts = [p.strip() for p in first.split(",")]
    # Drop date-range tokens like "1743-1826" or "1809-".
    parts = [p for p in parts if not re.match(r"^\d{3,4}\??-?\d{0,4}\??$", p)]
    if not parts:
        return None
    last = parts[0]
    given = parts[1] if len(parts) > 1 else ""
    # Strip parenthetical expansions: "John F. (John Fitzgerald)" -> "John F."
    given = re.sub(r"\([^)]*\)", "", given).strip()
    name = (given + " " + last).strip()
    name = re.sub(r"\s+", " ", name)
    return name or None


def main():
    rows = load_catalog()
    print(f"Total catalog rows: {len(rows)}")

    pool = {}  # id -> {id, title, author}
    for r in rows:
        if r["Type"] != "Text":
            continue
        if r["Language"].strip() != "en":
            continue
        try:
            book_id = int(r["Text#"])
        except ValueError:
            continue
        title = clean_title(r["Title"])
        if not title or TITLE_SKIP.match(title):
            continue
        if len(title) > 200:
            title = title[:197].rstrip() + "…"
        pool[book_id] = {"id": book_id, "title": title, "author": clean_author(r["Authors"])}

    print(f"Eligible English prose books: {len(pool)}")

    all_ids = sorted(pool.keys())
    random.seed(SEED)
    sample_ids = set(random.sample(all_ids, min(TARGET, len(all_ids))))

    # Guarantee curated classics are present (overriding title/author with our
    # hand-checked versions).
    for bid, title, author in CURATED:
        pool[bid] = {"id": bid, "title": title, "author": author}
        sample_ids.add(bid)

    manifest = [pool[i] for i in sorted(sample_ids)]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUT) / 1024
    with_author = sum(1 for b in manifest if b["author"])
    print(f"Wrote {len(manifest)} books to {OUT} ({size_kb:.0f} KB)")
    print(f"  with author: {with_author}  |  anonymous: {len(manifest) - with_author}")


if __name__ == "__main__":
    main()
