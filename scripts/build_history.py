"""Einmalfüller: schreibt den Score-Verlauf in das bestehende data.js.

Der nächtliche Lauf erzeugt den Verlauf selbst. Dieses Skript füllt nur den
bereits veröffentlichten Stand nach, damit der Chart nicht bis zum nächsten
Handelstag leer bleibt. Es rührt Kurse, Kennzahlen und meta nicht an.
"""

from __future__ import annotations

import json
import os
import pickle
import re
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import signals  # noqa: E402
from update_data import rsi  # noqa: E402

DATA_JS = os.path.join(os.path.dirname(HERE), "data.js")
FRAMES = "/tmp/sig/frames.pkl"


def main() -> int:
    txt = open(DATA_JS, encoding="utf-8").read()
    m = re.search(r"window\.DATA\s*=\s*(\{.*\})\s*;?\s*$", txt, re.S)
    payload = json.loads(m.group(1))
    frames: dict[str, pd.DataFrame] = pickle.load(open(FRAMES, "rb"))

    done = 0
    for tk, ser in payload["series"].items():
        df = frames.get(tk)
        if df is None:
            print(f"  {tk}: keine Tagesdaten, kein Verlauf")
            continue
        h = signals.history(df, rsi, ser["d"])
        if not h:
            print(f"  {tk}: Verlauf nicht berechenbar")
            continue
        ser["s"], ser["ev"] = h["s"], h["ev"]
        done += 1

    with open(DATA_JS, "w", encoding="utf-8") as fh:
        fh.write("/* Automatisch erzeugt von scripts/update_data.py. Nicht von Hand bearbeiten. */\n")
        fh.write("window.DATA = ")
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")

    ev = sum(len(s.get("ev", [])) for s in payload["series"].values())
    print(f"Verlauf für {done} von {len(payload['series'])} Titeln, {ev} Eintritte")
    print(f"data.js: {os.path.getsize(DATA_JS) / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
