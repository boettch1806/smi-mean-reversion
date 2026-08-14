#!/usr/bin/env python3
"""Rechnet Signal-Score und Rückwärtstest und fügt sie dem bestehenden data.js hinzu.

Der Score der aktuellen Zeile kommt aus den bereits veröffentlichten Kennzahlen,
damit Anzeige und Signal denselben Stichtag beschreiben. Die Rückwärtstest-Werte
stammen aus der vollen Tageshistorie, die für den Rückwärtstest neu geladen wird;
die im Dashboard mitgelieferten Kursreihen sind auf Wochenwerte verdichtet und
dafür zu grob.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import signals as sg
import update_data as ud


def main() -> int:
    txt = open(ud.DATA_JS, encoding="utf-8").read()
    data = json.loads(re.search(r"window\.DATA\s*=\s*(\{.*\})\s*;", txt, re.S).group(1))

    start = (datetime.now(timezone.utc) - timedelta(days=ud.LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    frames = ud.download(ud.ALL, start)
    print(f"Geladen: {len(frames)}/{len(ud.ALL)}", flush=True)
    if len(frames) < ud.MIN_OK:
        print("ABBRUCH: zu wenige Titel geladen.")
        return 1

    per: dict[str, dict] = {}
    for tk, df in frames.items():
        bt = sg.backtest(df, ud.rsi)
        if bt:
            per[tk] = bt
    print(f"Rückwärtstest möglich für {len(per)} Titel", flush=True)

    agg = sg.pool(per)
    for r in data["rows"]:
        sc = sg.score(r.get("z"), r.get("rsi"))
        r["score"] = sc
        r["sig"] = sg.label(sc)
        bt = per.get(r["ticker"])
        r["bt"] = sg.strip_raw(bt) if bt else None

    data["meta"]["signal"] = {
        "trigger": sg.TRIGGER, "strong": sg.STRONG, "watch": sg.WATCH,
        "w_z": sg.W_Z, "w_rsi": sg.W_RSI,
        "z_full": sg.Z_FULL, "rsi_full": sg.RSI_FULL,
        "z_window": sg.Z_WINDOW, "horizons": list(sg.HORIZONS),
        "min_events": sg.MIN_TICKER_EVENTS,
        "tested": len(per), "agg": agg,
    }

    with open(ud.DATA_JS, "w", encoding="utf-8") as fh:
        fh.write("/* Automatisch erzeugt von scripts/update_data.py. Nicht von Hand bearbeiten. */\n"
                 "window.DATA = ")
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")

    for side in ("buy", "sell"):
        a = agg[side]
        print(f"\n{side}: {a['n']} Ereignisse")
        for h in sg.HORIZONS:
            print(f"  {h:>2}T  Treffer {a[f'hit{h}']}% vs. Zufall {a[f'ref_hit{h}']}% "
                  f"(Mehrwert {a[f'edge_hit{h}']} Pp) | Median {a[f'med{h}']}% "
                  f"vs. {a[f'ref_med{h}']}% (Mehrwert {a[f'edge_med{h}']} Pp)")
    b = agg["base"]
    print(f"\nunbedingt: {b['n']} Tage, Treffer 20T {b['hit20']}%, Median 20T {b['med20']}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
