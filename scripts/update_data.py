#!/usr/bin/env python3
"""Berechnet die Mean-Reversion-Kennzahlen für SMI und SMIM neu und schreibt data.js.

Datenquelle: Yahoo Finance über yfinance, unbereinigte Tagesschlusskurse in CHF.
Titel, für die kein Kurs geladen werden kann, werden aus dem bestehenden data.js
übernommen und im Dashboard als veraltet markiert, damit ein Ausfall beim
Datenanbieter keine Zeile aus dem Dashboard entfernt.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
from datetime import date, datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import signals  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, "data.js")
DATA_CSV = os.path.join(ROOT, "data", "mean_reversion.csv")

# Indexzusammensetzung per 13.08.2026, vor der SIX-Anpassung vom 21.09.2026.
SMI = ["NESN.SW", "NOVN.SW", "ROG.SW", "ABBN.SW", "UBSG.SW", "CFR.SW", "ZURN.SW", "HOLN.SW",
       "SREN.SW", "LONN.SW", "SCMN.SW", "GIVN.SW", "ALC.SW", "SIKA.SW", "AMRZ.SW", "SLHN.SW",
       "KNIN.SW", "GEBN.SW", "PGHN.SW", "LOGN.SW"]
SMIM = ["STMN.SW", "SDZ.SW", "VACN.SW", "SGSN.SW", "LISN.SW", "LISP.SW", "BAER.SW", "SCHP.SW",
        "SCHN.SW", "RO.SW", "ADEN.SW", "SPSN.SW", "SIGN.SW", "UHR.SW", "HBAN.SW", "PSPN.SW",
        "TEMN.SW", "BARN.SW", "GF.SW", "EMSN.SW", "BEAN.SW", "GALE.SW", "AVOL.SW", "FHZN.SW",
        "CLN.SW", "GALD.SW", "SOON.SW", "SQN.SW", "ACLN.SW", "SUNN.SW"]
ALL = SMI + SMIM

NAMES = {
    "NESN.SW": "Nestlé", "NOVN.SW": "Novartis", "ROG.SW": "Roche GS", "ABBN.SW": "ABB",
    "UBSG.SW": "UBS Group", "CFR.SW": "Richemont", "ZURN.SW": "Zurich Insurance",
    "HOLN.SW": "Holcim", "SREN.SW": "Swiss Re", "LONN.SW": "Lonza", "SCMN.SW": "Swisscom",
    "GIVN.SW": "Givaudan", "ALC.SW": "Alcon", "SIKA.SW": "Sika", "AMRZ.SW": "Amrize",
    "SLHN.SW": "Swiss Life", "KNIN.SW": "Kühne+Nagel", "GEBN.SW": "Geberit",
    "PGHN.SW": "Partners Group", "LOGN.SW": "Logitech", "STMN.SW": "Straumann",
    "SDZ.SW": "Sandoz", "VACN.SW": "VAT Group", "SGSN.SW": "SGS", "LISN.SW": "Lindt & Sprüngli N",
    "LISP.SW": "Lindt & Sprüngli PS", "BAER.SW": "Julius Bär", "SCHP.SW": "Schindler PS",
    "SCHN.SW": "Schindler N", "RO.SW": "Roche N", "ADEN.SW": "Adecco",
    "SPSN.SW": "Swiss Prime Site", "SIGN.SW": "SIG Group", "UHR.SW": "Swatch Group",
    "HBAN.SW": "Helvetia Baloise", "PSPN.SW": "PSP Swiss Property", "TEMN.SW": "Temenos",
    "BARN.SW": "Barry Callebaut", "GF.SW": "Georg Fischer", "EMSN.SW": "EMS-Chemie",
    "BEAN.SW": "Belimo", "GALE.SW": "Galenica", "AVOL.SW": "Avolta",
    "FHZN.SW": "Flughafen Zürich", "CLN.SW": "Clariant", "GALD.SW": "Galderma",
    "SOON.SW": "Sonova", "SQN.SW": "Swissquote", "ACLN.SW": "Accelleron", "SUNN.SW": "Sunrise",
}
SECTOR = {
    "NESN.SW": "Nahrungsmittel", "NOVN.SW": "Pharma", "ROG.SW": "Pharma", "ABBN.SW": "Industrie",
    "UBSG.SW": "Banken", "CFR.SW": "Luxus", "ZURN.SW": "Versicherung", "HOLN.SW": "Baustoffe",
    "SREN.SW": "Versicherung", "LONN.SW": "Life Science", "SCMN.SW": "Telekom",
    "GIVN.SW": "Chemie", "ALC.SW": "Medtech", "SIKA.SW": "Baustoffe", "AMRZ.SW": "Baustoffe",
    "SLHN.SW": "Versicherung", "KNIN.SW": "Logistik", "GEBN.SW": "Industrie",
    "PGHN.SW": "Private Markets", "LOGN.SW": "Technologie", "STMN.SW": "Medtech",
    "SDZ.SW": "Pharma", "VACN.SW": "Halbleiter", "SGSN.SW": "Dienstleistungen",
    "LISN.SW": "Nahrungsmittel", "LISP.SW": "Nahrungsmittel", "BAER.SW": "Banken",
    "SCHP.SW": "Industrie", "SCHN.SW": "Industrie", "RO.SW": "Pharma", "ADEN.SW": "Personal",
    "SPSN.SW": "Immobilien", "SIGN.SW": "Verpackung", "UHR.SW": "Luxus",
    "HBAN.SW": "Versicherung", "PSPN.SW": "Immobilien", "TEMN.SW": "Software",
    "BARN.SW": "Nahrungsmittel", "GF.SW": "Industrie", "EMSN.SW": "Chemie",
    "BEAN.SW": "Industrie", "GALE.SW": "Gesundheit", "AVOL.SW": "Detailhandel",
    "FHZN.SW": "Infrastruktur", "CLN.SW": "Chemie", "GALD.SW": "Pharma", "SOON.SW": "Medtech",
    "SQN.SW": "Banken", "ACLN.SW": "Industrie", "SUNN.SW": "Telekom",
}

# Historie: 5 Jahre Z-Score-Fenster plus Vorlauf, damit der 200-Tage-Durchschnitt
# über das gesamte Fenster definiert ist.
LOOKBACK_DAYS = 5 * 365 + 400
MIN_OK = 45          # weniger geladene Titel gilt als fehlgeschlagener Lauf
MIN_COVERAGE = 0.80  # Anteil der Titel, der einen Stichtag bestätigen muss
MAX_STALE_DAYS = 4   # Kursreihe, die älter ist als der Stichtag, gilt als veraltet
ZURICH = ZoneInfo("Europe/Zurich")
SIX_SETTLED = dtime(18, 0)  # SIX schliesst um 17:30 Ortszeit, danach gilt der Schlusskurs


# --------------------------------------------------------------------------- Kennzahlen
def rsi(series: pd.Series, n: int = 14) -> pd.Series:
    """RSI nach Wilder, exponentielle Glättung mit Alpha = 1/n."""
    d = series.diff()
    up = d.clip(lower=0)
    dn = -d.clip(upper=0)
    au = up.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    ad = dn.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = au / ad.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).where(ad != 0, 100.0)


def metrics(ticker: str, df: pd.DataFrame) -> tuple[dict, dict | None]:
    """Berechnet eine Dashboard-Zeile und die abgetastete Z-Verlaufsreihe."""
    df = df.sort_values("date").dropna(subset=["close"]).reset_index(drop=True)
    df["rsi14"] = rsi(df["close"], 14)
    df["sma200"] = df["close"].rolling(200, min_periods=200).mean()
    df["spread"] = np.log(df["close"]) - np.log(df["sma200"])

    last = df.iloc[-1]
    hist5 = df[df["date"] >= df["date"].iloc[-1] - pd.Timedelta(days=365 * 5)]
    sp = hist5["spread"].dropna()

    z = sp_mean = sp_sd = np.nan
    if len(sp) >= 250:
        sp_mean, sp_sd = sp.mean(), sp.std(ddof=1)
        if sp_sd and sp_sd > 0:
            z = (df["spread"].iloc[-1] - sp_mean) / sp_sd

    r = np.log(df["close"]).diff()
    vol1y = r.tail(252).std(ddof=1) * math.sqrt(252) * 100 if r.tail(252).notna().sum() > 100 else np.nan
    r5 = np.log(hist5["close"]).diff()
    vol5y = r5.std(ddof=1) * math.sqrt(252) * 100 if r5.notna().sum() > 250 else np.nan

    dur = halflife = hit = np.nan
    n_ep = None
    if len(sp) >= 250 and sp_sd and sp_sd > 0:
        zv = ((hist5["spread"] - sp_mean) / sp_sd).reset_index(drop=True).values
        durations, resolved, episodes = [], 0, 0
        i = 0
        while i < len(zv):
            if not np.isnan(zv[i]) and abs(zv[i]) > 1.0:
                sign, start, j = np.sign(zv[i]), i, i + 1
                while j < len(zv) and np.sign(zv[j]) == sign:
                    j += 1
                episodes += 1
                if j < len(zv):
                    durations.append(j - start)
                    resolved += 1
                i = j + 1
            else:
                i += 1
        if durations:
            dur = float(np.mean(durations))
            hit = 100.0 * resolved / episodes
        n_ep = episodes
        x = sp.values
        x0, x1 = x[:-1], x[1:]
        xm = x0 - x0.mean()
        phi = float(np.dot(xm, x1 - x1.mean()) / np.dot(xm, xm))
        if 0 < phi < 1:
            halflife = -math.log(2) / math.log(phi)

    def num(v, nd):
        return None if v is None or pd.isna(v) else round(float(v), nd)

    sma = num(last["sma200"], 2)
    row = dict(
        ticker=ticker, name=NAMES[ticker], index="SMI" if ticker in SMI else "SMIM",
        sector=SECTOR[ticker], last_date=str(last["date"].date()),
        close=num(last["close"], 2), rsi=num(last["rsi14"], 1), sma200=sma,
        dist200=None if sma is None else round(100 * (float(last["close"]) / sma - 1), 2),
        z=num(z, 2), vol1y=num(vol1y, 1), vol5y=num(vol5y, 1),
        rev_days=num(dur, 0), halflife=num(halflife, 0),
        episodes=n_ep, hitrate=num(hit, 0), obs=int(len(df)),
    )

    ser = None
    s = hist5[["date", "close", "sma200", "spread"]].dropna(subset=["sma200"]).copy()
    if len(s) and sp_sd and sp_sd > 0:
        s["z"] = (s["spread"] - sp_mean) / sp_sd
        s = s.iloc[::5]
        ser = dict(d=[d.strftime("%Y-%m-%d") for d in s["date"]],
                   p=[round(float(v), 2) for v in s["close"]],
                   m=[round(float(v), 2) for v in s["sma200"]],
                   z=[round(float(v), 2) for v in s["z"]])
    return row, ser


# --------------------------------------------------------------------------- Datenbezug
def frame_for(raw: pd.DataFrame, ticker: str) -> pd.DataFrame | None:
    """Zieht eine Ticker-Spalte aus dem yfinance-Ergebnis."""
    try:
        if isinstance(raw.columns, pd.MultiIndex):
            if ticker not in raw.columns.get_level_values(0):
                return None
            close = raw[ticker]["Close"]
        else:
            close = raw["Close"]
    except (KeyError, IndexError):
        return None
    close = pd.to_numeric(close, errors="coerce").dropna()
    df = pd.DataFrame({"date": pd.to_datetime(close.index).tz_localize(None),
                       "close": close.values})
    # Laufender Handelstag ist kein Schlusskurs: solange die Börse offen ist, verwerfen.
    now = datetime.now(ZURICH)
    if now.time() < SIX_SETTLED:
        df = df[df["date"].dt.date < now.date()]
    if len(df) < 220:
        return None
    return df.reset_index(drop=True)


def consensus_asof(frames: dict[str, pd.DataFrame]) -> date:
    """Jüngster Handelstag, den mindestens MIN_COVERAGE der Titel bestätigen.

    Yahoo stellt die Tagesbalken nicht für alle Titel gleichzeitig fertig. Ohne
    diesen Abgleich würde das Dashboard Kennzahlen unterschiedlicher Stichtage
    nebeneinander zeigen, was einen Quervergleich von RSI und Z-Score entwertet.
    """
    counts: dict[date, int] = {}
    for df in frames.values():
        for d in df["date"].dt.date.tail(10):
            counts[d] = counts.get(d, 0) + 1
    need = max(1, int(round(MIN_COVERAGE * len(frames))))
    ok = [d for d, c in counts.items() if c >= need]
    if not ok:
        raise RuntimeError("kein Handelstag mit ausreichender Abdeckung gefunden")
    return max(ok)


def download(tickers: list[str], start: str) -> dict[str, pd.DataFrame]:
    """Lädt Schlusskurse, mit Einzelabfrage als zweiter Chance je Titel."""
    out: dict[str, pd.DataFrame] = {}
    for attempt in range(1, 4):
        todo = [t for t in tickers if t not in out]
        if not todo:
            break
        if attempt > 1:
            wait = 10 * attempt
            print(f"  Wiederholung {attempt} für {len(todo)} Titel in {wait}s", flush=True)
            time.sleep(wait)
        try:
            raw = yf.download(todo, start=start, interval="1d", auto_adjust=False,
                              group_by="ticker", progress=False, threads=False,
                              timeout=60)
        except Exception as exc:  # Netzfehler, Rate-Limit
            print(f"  Sammelabfrage fehlgeschlagen: {exc}", flush=True)
            continue
        if raw is None or raw.empty:
            continue
        for t in todo:
            df = frame_for(raw, t)
            if df is not None:
                out[t] = df
    return out


# --------------------------------------------------------------------------- data.js
def load_previous() -> dict:
    """Liest das bestehende data.js, um Ausfälle überbrücken zu können."""
    if not os.path.exists(DATA_JS):
        return {"rows": [], "series": {}}
    txt = open(DATA_JS, encoding="utf-8").read()
    m = re.search(r"window\.DATA\s*=\s*(\{.*\})\s*;?\s*$", txt, re.S)
    if not m:
        return {"rows": [], "series": {}}
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return {"rows": [], "series": {}}


def write_outputs(rows: list[dict], series: dict, meta: dict) -> None:
    payload = {"meta": meta, "rows": rows, "series": series}
    with open(DATA_JS, "w", encoding="utf-8") as fh:
        fh.write("/* Automatisch erzeugt von scripts/update_data.py. Nicht von Hand bearbeiten. */\n")
        fh.write("window.DATA = ")
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    os.makedirs(os.path.dirname(DATA_CSV), exist_ok=True)
    cols = ["ticker", "name", "index", "sector", "last_date", "close", "rsi", "sma200",
            "dist200", "z", "vol1y", "vol5y", "rev_days", "halflife", "episodes",
            "hitrate", "obs", "score", "sig", "stale"]
    pd.DataFrame(rows).reindex(columns=cols).to_csv(DATA_CSV, index=False)


# --------------------------------------------------------------------------- Ablauf
def main() -> int:
    start = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    print(f"Lade Kurse ab {start} für {len(ALL)} Titel", flush=True)
    frames = download(ALL, start)
    print(f"Geladen: {len(frames)}/{len(ALL)}", flush=True)

    if len(frames) < MIN_OK:
        print(f"ABBRUCH: nur {len(frames)} von {len(ALL)} Titeln geladen "
              f"(Mindestwert {MIN_OK}). data.js bleibt unverändert.", flush=True)
        return 1

    asof = consensus_asof(frames)
    print(f"Stichtag mit ausreichender Abdeckung: {asof}", flush=True)
    for tk in list(frames):
        frames[tk] = frames[tk][frames[tk]["date"].dt.date <= asof].reset_index(drop=True)
        if len(frames[tk]) < 220:
            del frames[tk]

    prev = load_previous()
    prev_rows = {r["ticker"]: r for r in prev.get("rows", [])}
    prev_series = prev.get("series", {})
    prev_asof = (prev.get("meta") or {}).get("asof")
    if prev_asof and str(asof) <= prev_asof:
        print(f"Kein neuer Handelstag: Stichtag {asof}, bestehender Stand {prev_asof}. "
              f"data.js bleibt unverändert.", flush=True)
        return 0

    rows: list[dict] = []
    series: dict = {}
    computed, carried, dropped = [], [], []

    for tk in ALL:
        df = frames.get(tk)
        if df is not None:
            try:
                row, ser = metrics(tk, df)
                row["stale"] = False
                rows.append(row)
                if ser:
                    series[tk] = ser
                computed.append(tk)
                continue
            except Exception as exc:
                print(f"  {tk}: Berechnung fehlgeschlagen ({exc})", flush=True)
        if tk in prev_rows:
            row = dict(prev_rows[tk])
            row["stale"] = True
            rows.append(row)
            if tk in prev_series:
                series[tk] = prev_series[tk]
            carried.append(tk)
        else:
            dropped.append(tk)

    if len(computed) < MIN_OK:
        print(f"ABBRUCH: nur {len(computed)} von {len(ALL)} Titeln neu berechnet "
              f"(Mindestwert {MIN_OK}). data.js bleibt unverändert.", flush=True)
        return 1

    # Kursreihen, die hinter dem Stichtag zurückliegen, als veraltet markieren.
    cutoff = (asof - timedelta(days=MAX_STALE_DAYS)).isoformat()
    for r in rows:
        if r["last_date"] < cutoff:
            r["stale"] = True
    asof = str(asof)

    # Signal-Score und Rückwärtstest. Der Score kommt aus den eben berechneten
    # Kennzahlen, die Trefferquoten aus der vollen Tageshistorie desselben Laufs.
    per_bt: dict[str, dict] = {}
    for tk, df in frames.items():
        try:
            bt = signals.backtest(df, rsi)
        except Exception as exc:
            print(f"  {tk}: Rückwärtstest fehlgeschlagen ({exc})", flush=True)
            continue
        if bt:
            per_bt[tk] = bt
    sig_agg = signals.pool(per_bt) if per_bt else None
    prev_bt = {r["ticker"]: r.get("bt") for r in prev.get("rows", [])}
    for r in rows:
        sc = signals.score(r.get("z"), r.get("rsi"))
        r["score"] = sc
        r["sig"] = signals.label(sc)
        bt = per_bt.get(r["ticker"])
        # Für übernommene Titel bleibt der bisherige Rückwärtstest stehen.
        r["bt"] = signals.strip_raw(bt) if bt else prev_bt.get(r["ticker"])
    print(f"Rückwärtstest: {len(per_bt)} Titel auswertbar", flush=True)

    stale = sorted(r["ticker"] for r in rows if r["stale"])
    meta = {
        "asof": asof,
        "generated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "Yahoo Finance (yfinance), unbereinigte Schlusskurse in CHF",
        "count": len(rows),
        "stale": stale,
    }
    if sig_agg:
        meta["signal"] = {
            "trigger": signals.TRIGGER, "strong": signals.STRONG, "watch": signals.WATCH,
            "w_z": signals.W_Z, "w_rsi": signals.W_RSI,
            "z_full": signals.Z_FULL, "rsi_full": signals.RSI_FULL,
            "z_window": signals.Z_WINDOW, "horizons": list(signals.HORIZONS),
            "min_events": signals.MIN_TICKER_EVENTS,
            "tested": len(per_bt), "agg": sig_agg,
        }
    elif (prev.get("meta") or {}).get("signal"):
        meta["signal"] = prev["meta"]["signal"]
    write_outputs(rows, series, meta)

    print(f"Stand: {asof} | Titel: {len(rows)} | neu berechnet: {len(computed)} | "
          f"übernommen: {len(carried)}", flush=True)
    if stale:
        print("Veraltet: " + ", ".join(stale), flush=True)
    if dropped:
        print("Ohne Daten und ohne Vorwert: " + ", ".join(dropped), flush=True)

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        hot = [r for r in rows if r.get("rsi") is not None and r["rsi"] > 70 and not r["stale"]]
        cold = [r for r in rows if r.get("rsi") is not None and r["rsi"] < 30 and not r["stale"]]
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### Datenstand {asof}\n\n")
            fh.write(f"- Titel: {len(rows)}, neu berechnet: {len(computed)}, "
                     f"übernommen: {len(carried)}\n")
            fh.write("- Überkauft (RSI > 70): "
                     + (", ".join(f"{r['name']} {r['rsi']}" for r in hot) or "keine") + "\n")
            fh.write("- Überverkauft (RSI < 30): "
                     + (", ".join(f"{r['name']} {r['rsi']}" for r in cold) or "keine") + "\n")
            if stale:
                fh.write("- Veraltete Kursreihen: " + ", ".join(stale) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
