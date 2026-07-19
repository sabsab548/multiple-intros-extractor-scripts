#!/usr/bin/env python3
"""
merge_greetings.py

Takes the combined JSON exported by the Tampermonkey "Janitor Greeting Scraper"
and writes the extracted greetings into the alternate_greetings field of the
matching local SillyTavern character PNGs, then re-saves the PNGs in place.

Usage:
    python merge_greetings.py janitor_greetings_combined.json /path/to/ST/characters

What it does per character:
    - Matches the scraped entry to a local PNG by normalized character name
    - Decodes both the "chara" (V2) and "ccv3" (V3) embedded chunks
    - Sets data.alternate_greetings to the scraped greetings, EXCLUDING any
      greeting that's an exact duplicate of the existing first_mes
    - Re-encodes and writes the PNG back to disk (original is backed up first)

Anything that can't be matched is reported at the end instead of guessed at.
"""

import sys
import os
import re
import json
import base64
import struct
import zlib
import shutil


def normalize_name(name: str) -> str:
    """Loose match key: lowercase, strip punctuation/emoji/pipes, collapse whitespace."""
    if not name:
        return ""
    name = name.split("|")[0]           # "Ethan Vance | Mean Fratboy" -> "Ethan Vance"
    name = re.sub(r"[^\w\s]", "", name, flags=re.UNICODE)
    name = re.sub(r"\s+", " ", name).strip().lower()
    return name


def read_png_chunks(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a valid PNG")
    chunks = []
    i = 8
    while i < len(data):
        length = struct.unpack(">I", data[i:i + 4])[0]
        ctype = data[i + 4:i + 8]
        cdata = data[i + 8:i + 8 + length]
        crc = data[i + 8 + length:i + 12 + length]
        chunks.append([ctype, cdata, crc])
        i += 12 + length
    return chunks


def write_png_chunks(path, chunks):
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        for ctype, cdata, _ in chunks:
            length = struct.pack(">I", len(cdata))
            crc = struct.pack(">I", zlib.crc32(ctype + cdata) & 0xFFFFFFFF)
            f.write(length + ctype + cdata + crc)


def make_text_chunk(keyword: str, text_bytes: bytes):
    cdata = keyword.encode("latin-1") + b"\x00" + text_bytes
    return [b"tEXt", cdata, b""]


def decode_text_chunk(cdata: bytes):
    nul = cdata.index(b"\x00")
    keyword = cdata[:nul].decode("latin-1")
    text = cdata[nul + 1:]
    return keyword, text


def load_card_json(chunks, keyword):
    for ctype, cdata, _ in chunks:
        if ctype == b"tEXt":
            kw, text = decode_text_chunk(cdata)
            if kw == keyword:
                return json.loads(base64.b64decode(text))
    return None


def get_card_name(card_json):
    if not card_json:
        return None
    data = card_json.get("data", card_json)
    return data.get("name") or card_json.get("name")


def get_first_mes(card_json):
    if not card_json:
        return ""
    data = card_json.get("data", card_json)
    return (data.get("first_mes") or card_json.get("first_mes") or "").strip()


def set_alternate_greetings(card_json, greetings):
    if "data" in card_json:
        card_json["data"]["alternate_greetings"] = greetings
    card_json["alternate_greetings"] = greetings  # some readers check top level too
    return card_json


def main():
    if len(sys.argv) != 3:
        print("Usage: python merge_greetings.py <combined_json> <characters_folder>")
        sys.exit(1)

    json_path, char_dir = sys.argv[1], sys.argv[2]

    with open(json_path, "r", encoding="utf-8") as f:
        scraped = json.load(f)  # {id: {name, url, greetings: [...]}}

    # Build lookup: normalized scraped name -> entry
    scraped_by_name = {}
    for entry in scraped.values():
        key = normalize_name(entry.get("name", ""))
        if key:
            scraped_by_name[key] = entry

    png_files = [f for f in os.listdir(char_dir) if f.lower().endswith(".png")]

    matched, unmatched_local, skipped_no_greetings = [], [], []
    backup_dir = os.path.join(char_dir, "_pre_greeting_merge_backup")
    os.makedirs(backup_dir, exist_ok=True)

    for fname in png_files:
        fpath = os.path.join(char_dir, fname)
        try:
            chunks = read_png_chunks(fpath)
        except Exception as e:
            print(f"[skip] {fname}: could not read PNG ({e})")
            continue

        chara_json = load_card_json(chunks, "chara")
        ccv3_json = load_card_json(chunks, "ccv3")
        card_name = get_card_name(chara_json) or get_card_name(ccv3_json) or os.path.splitext(fname)[0]

        key = normalize_name(card_name)
        entry = scraped_by_name.get(key)
        if not entry:
            unmatched_local.append(card_name)
            continue

        greetings = entry.get("greetings", [])
        # drop empties and exact duplicate of the existing first_mes
        first_mes = get_first_mes(chara_json or ccv3_json)
        cleaned = [g.strip() for g in greetings if g and g.strip() and g.strip() != first_mes]

        if not cleaned:
            skipped_no_greetings.append(card_name)
            continue

        # back up original before touching it
        shutil.copy2(fpath, os.path.join(backup_dir, fname))

        new_chunks = []
        for ctype, cdata, crc in chunks:
            if ctype == b"tEXt":
                kw, _ = decode_text_chunk(cdata)
                if kw in ("chara", "ccv3"):
                    continue  # drop old ones, we'll re-add updated versions below
            new_chunks.append([ctype, cdata, crc])

        # insert updated text chunks right before IEND
        iend_index = next(i for i, c in enumerate(new_chunks) if c[0] == b"IEND")

        if chara_json:
            chara_json = set_alternate_greetings(chara_json, cleaned)
            b64 = base64.b64encode(json.dumps(chara_json).encode("utf-8"))
            new_chunks.insert(iend_index, make_text_chunk("chara", b64))
            iend_index += 1

        if ccv3_json:
            ccv3_json = set_alternate_greetings(ccv3_json, cleaned)
            b64 = base64.b64encode(json.dumps(ccv3_json).encode("utf-8"))
            new_chunks.insert(iend_index, make_text_chunk("ccv3", b64))
            iend_index += 1

        write_png_chunks(fpath, new_chunks)
        matched.append((card_name, len(cleaned)))

    print("\n=== DONE ===")
    print(f"Updated: {len(matched)} cards")
    for name, n in matched:
        print(f"  + {name}: {n} alternate greeting(s) added")

    if skipped_no_greetings:
        print(f"\nMatched but nothing new to add ({len(skipped_no_greetings)}):")
        for name in skipped_no_greetings:
            print(f"  - {name}")

    if unmatched_local:
        print(f"\nLocal PNGs with no scraped match ({len(unmatched_local)}) - check names manually:")
        for name in unmatched_local:
            print(f"  ? {name}")

    unused_scraped = set(scraped_by_name) - {normalize_name(n) for n, _ in matched} - {normalize_name(n) for n in skipped_no_greetings}
    if unused_scraped:
        print(f"\nScraped entries with no matching local PNG ({len(unused_scraped)}):")
        for key in unused_scraped:
            print(f"  ? {scraped_by_name[key]['name']}")

    print(f"\nOriginals backed up to: {backup_dir}")


if __name__ == "__main__":
    main()
