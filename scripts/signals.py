"""Signal-Score und Rückwärtstest für das Mean-Reversion-Dashboard.

Vier Dinge sind hier bewusst streng gehalten:

1. Kein Blick in die Zukunft. Der Z-Score des Rückwärtstests wird an einem
   mitlaufenden Fünfjahresfenster normiert, das nur Daten bis zum jeweiligen Tag
   kennt. Die im Dashboard angezeigte Kennzahl normiert am gesamten Fenster; für
   die Anzeige ist das richtig, für eine Messung wäre es geschönt.

2. Jede Trefferquote wird gegen einen unbedingten Vergleichswert gestellt, also
   gegen die Trefferquote eines beliebigen Tages desselben Titels im selben
   Zeitraum. Eine Quote von 55 Prozent ist wertlos, wenn der Zufall 58 liefert.
   Der Aussagewert steckt in der Differenz, nicht in der Quote.

3. Gezählt wird nur der Eintritt in ein Signal, nicht jeder Tag darin. Sonst
   wird eine einzige lange Schwächephase als hundert Ereignisse gezählt, und die
   überlappenden Messfenster täuschen einen Mehrwert vor, den es nicht gibt.

4. Die Streuung über die Zeit wird mitgemessen. Ein Mehrwert, der aus zwei
   Quartalen stammt, ist eine Wette auf zwei Marktphasen und keine Trefferquote.
   Dafür steht qpos: der Anteil der Kalenderquartale, in denen die Mehrheit der
   Signale dieses Quartals nach zwanzig Tagen richtig lag.

Die Schwelle TRIGGER ist nicht gesetzt, sondern gemessen: Bei 40 zeigte der
Rückwärtstest über alle 46 auswertbaren Titel keinen Mehrwert gegenüber einem
beliebigen Tag. Ein Mehrwert entsteht erst ab 70.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Gewichtung des Scores. Der Z-Score trägt die Hauptlast, weil er die Abweichung
# an der titelspezifischen Streuung normiert; der RSI dient der zeitlichen
# Bestätigung. Der prozentuale Abstand zur 200-Tage-Linie geht absichtlich nicht
# ein: Er steckt bereits unnormiert im Z-Score und würde doppelt zählen.
# Eine Prüfung der Gewichte von 0/100 bis 100/0 ergab an der Schwelle 70 überall
# einen Mehrwert zwischen 4 und 10 Prozentpunkten ohne klaren Sieger. Die
# Gewichtung bleibt daher, wie sie sachlich begründet ist, statt auf das beste
# Ergebnis der Prüfung hin optimiert zu werden.
W_Z, W_RSI = 0.65, 0.35
Z_FULL = 2.5   # Z-Score, ab dem der Beitrag voll ausgereizt ist
RSI_FULL = 25  # RSI-Abstand von 50, ab dem der Beitrag voll ausgereizt ist

TRIGGER = 70   # ab diesem Score gilt ein Signal als ausgelöst
STRONG = 85    # ab diesem Score gilt es als deutlich
WATCH = 55     # auffällig, aber ohne belegten Mehrwert

Z_WINDOW = 1260   # gut fünf Handelsjahre
Z_MIN_OBS = 250   # darunter ist die Normierung nicht belastbar
HORIZONS = (10, 20, 60)
MIN_TICKER_EVENTS = 20  # darunter ist eine titelspezifische Quote nicht belastbar


def _clamp(v: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def score(z: float | None, rsi_v: float | None) -> int | None:
    """Signal-Score von -100 (Verkauf) bis +100 (Kauf).

    Positiv heisst: gemessen an der eigenen Geschichte billig und schwach, also
    Kandidat für eine Rückkehr nach oben. Negativ heisst das Gegenteil.
    """
    if z is None or rsi_v is None or pd.isna(z) or pd.isna(rsi_v):
        return None
    zc = _clamp(-float(z) / Z_FULL)
    rc = _clamp((50.0 - float(rsi_v)) / RSI_FULL)
    return int(round(100 * (W_Z * zc + W_RSI * rc)))


def label(sc: int | None) -> str:
    if sc is None:
        return "kein Score"
    if sc >= STRONG:
        return "Kaufsignal deutlich"
    if sc >= TRIGGER:
        return "Kaufsignal"
    if sc >= WATCH:
        return "Beobachtung Kauf"
    if sc <= -STRONG:
        return "Verkaufssignal deutlich"
    if sc <= -TRIGGER:
        return "Verkaufssignal"
    if sc <= -WATCH:
        return "Beobachtung Verkauf"
    return "kein Signal"


def _score_series(z: pd.Series, rsi_v: pd.Series) -> pd.Series:
    zc = (-z / Z_FULL).clip(-1, 1)
    rc = ((50.0 - rsi_v) / RSI_FULL).clip(-1, 1)
    return 100 * (W_Z * zc + W_RSI * rc)


def causal_z(spread: pd.Series) -> pd.Series:
    """Z-Score an einem mitlaufenden Fenster, das keine künftigen Werte kennt."""
    m = spread.rolling(Z_WINDOW, min_periods=Z_MIN_OBS).mean()
    s = spread.rolling(Z_WINDOW, min_periods=Z_MIN_OBS).std(ddof=1)
    return (spread - m) / s.replace(0, np.nan)


def backtest(df: pd.DataFrame, rsi_fn) -> dict | None:
    """Misst, was historisch auf jedes Signal dieses Titels folgte.

    Erwartet Spalten date und close in aufsteigender Reihenfolge.
    """
    d = df.sort_values("date").dropna(subset=["close"]).reset_index(drop=True)
    if len(d) < Z_MIN_OBS + 200 + max(HORIZONS):
        return None

    close = d["close"].astype(float)
    sma = close.rolling(200, min_periods=200).mean()
    spread = np.log(close) - np.log(sma)
    z = causal_z(spread)
    sc = _score_series(z, rsi_fn(close, 14))

    valid = sc.notna()
    if int(valid.sum()) < 250:
        return None

    dates = pd.to_datetime(d["date"])
    fwd = {h: close.shift(-h) / close - 1.0 for h in HORIZONS}
    # Tiefster Punkt der nächsten zwanzig Handelstage, für den Zwischenverlust.
    low20 = close.shift(-1).rolling(20, min_periods=5).min().shift(-19)

    up = (sc >= TRIGGER).fillna(False).astype(bool)
    dn = (sc <= -TRIGGER).fillna(False).astype(bool)
    entries = {
        "buy": valid & up & ~up.shift(1, fill_value=False),
        "sell": valid & dn & ~dn.shift(1, fill_value=False),
    }

    out: dict = {}
    for side, mask in entries.items():
        idx = d.index[mask]
        n_eval = int(fwd[20].loc[idx].notna().sum())
        stats: dict = {"n": int(len(idx)), "n_eval": n_eval,
                       "thin": bool(n_eval < MIN_TICKER_EVENTS)}
        for h in HORIZONS:
            f = fwd[h].loc[idx].dropna()
            if len(f) >= 5:
                right = (f > 0) if side == "buy" else (f < 0)
                stats[f"hit{h}"] = round(100.0 * float(right.mean()), 0)
                stats[f"med{h}"] = round(100.0 * float(f.median()), 2)
            else:
                stats[f"hit{h}"], stats[f"med{h}"] = None, None
        if side == "buy":
            dd = (low20.loc[idx] / close.loc[idx] - 1.0).dropna()
            stats["dd20"] = round(100.0 * float(dd.median()), 2) if len(dd) >= 5 else None
        out[side] = stats

    # Unbedingter Vergleichswert: jeder Tag mit gültigem Score, gleicher Zeitraum.
    base: dict = {"n": int(valid.sum())}
    for h in HORIZONS:
        f = fwd[h][valid].dropna()
        if len(f) >= 100:
            base[f"hit{h}"] = round(100.0 * float((f > 0).mean()), 0)
            base[f"med{h}"] = round(100.0 * float(f.median()), 2)
        else:
            base[f"hit{h}"], base[f"med{h}"] = None, None
    out["base"] = base
    out["from"] = str(pd.Timestamp(dates[valid].iloc[0]).date())

    # Rohwerte samt Datum für die titelübergreifende Auswertung, nicht in data.js.
    raw: dict = {}
    for side, mask in entries.items():
        idx = d.index[mask]
        raw[side] = {"q": [str(p) for p in dates.loc[idx].dt.to_period("Q")]}
        raw[side].update({h: fwd[h].loc[idx].tolist() for h in HORIZONS})
    raw["base"] = {"q": [str(p) for p in dates[valid].dt.to_period("Q")]}
    raw["base"].update({h: fwd[h][valid].tolist() for h in HORIZONS})
    out["_raw"] = raw
    return out


def history(df: pd.DataFrame, rsi_fn, grid: list[str]) -> dict | None:
    """Score-Verlauf auf einem vorgegebenen Datumsraster samt Signaleintritten.

    Der Verlauf wird auf dasselbe wochenweise Raster gelegt, das das Dashboard
    schon für Kurs und Z-Score verwendet, damit keine zweite Datumsreihe in
    data.js landet. Die Eintritte dagegen stammen aus den Tagesdaten: ein Signal
    kann zwischen zwei Rasterpunkten beginnen und wieder enden, und genau diese
    kurzen Fälle würden bei einer wochenweisen Prüfung verschwinden. Der Score
    ist derselbe mitlaufende wie im Rückwärtstest, kennt also keine künftigen
    Kurse; die Kennzahl in der Tabelle normiert am gesamten Zeitraum und kann
    deshalb am rechten Rand leicht abweichen.
    """
    if not grid:
        return None
    d = df.sort_values("date").dropna(subset=["close"]).reset_index(drop=True)
    if len(d) < Z_MIN_OBS + 200:
        return None

    close = d["close"].astype(float)
    sma = close.rolling(200, min_periods=200).mean()
    z = causal_z(np.log(close) - np.log(sma))
    sc = _score_series(z, rsi_fn(close, 14))
    if sc.notna().sum() < 60:
        return None

    dates = pd.to_datetime(d["date"])
    fwd20 = close.shift(-20) / close - 1.0

    # Letzter gültiger Score je Rasterpunkt, ohne Blick nach vorne.
    # Beide Datumsreihen auf dieselbe Zeiteinheit bringen, sonst verweigert
    # merge_asof den Abgleich.
    ns = "datetime64[ns]"
    left = pd.DataFrame({"date": pd.to_datetime(pd.Series(grid)).astype(ns)})
    right = pd.DataFrame({"date": dates.astype(ns), "sc": sc}).dropna(subset=["sc"])
    if right.empty:
        return None
    merged = pd.merge_asof(left, right, on="date", direction="backward")
    line = [None if pd.isna(v) else int(round(v)) for v in merged["sc"]]
    if not any(v is not None for v in line):
        return None

    valid = sc.notna()
    up = (sc >= TRIGGER).fillna(False).astype(bool)
    dn = (sc <= -TRIGGER).fillna(False).astype(bool)
    ev: list[list] = []
    for side, mask in (("buy", valid & up & ~up.shift(1, fill_value=False)),
                       ("sell", valid & dn & ~dn.shift(1, fill_value=False))):
        for i in d.index[mask]:
            if dates.loc[i].to_datetime64() < left["date"].iloc[0].to_datetime64():
                continue
            f = fwd20.loc[i]
            ev.append([str(dates.loc[i].date()), 1 if side == "buy" else -1,
                       int(round(float(sc.loc[i]))),
                       None if pd.isna(f) else round(100.0 * float(f), 1)])
    ev.sort(key=lambda e: e[0])
    return {"s": line, "ev": ev}


def _quarter_share(quarters: list[str], vals: list[float], side: str) -> tuple:
    """Anteil der Quartale, in denen die Mehrheit der Signale richtig lag."""
    df = pd.DataFrame({"q": quarters, "v": vals}).dropna()
    if df.empty:
        return None, None
    right = df["v"] > 0 if side in ("buy", "base") else df["v"] < 0
    g = right.groupby(df["q"]).mean()
    if g.size < 4:
        return None, int(g.size)
    return round(100.0 * float((g > 0.5).mean()), 0), int(g.size)


def pool(per_ticker: dict[str, dict]) -> dict:
    """Fasst alle Titel zu einer Gesamtaussage zusammen, ein Ereignis eine Stimme."""
    agg: dict = {}
    for side in ("buy", "sell", "base"):
        acc = {h: [] for h in HORIZONS}
        qs: list[str] = []
        for bt in per_ticker.values():
            raw = bt.get("_raw", {}).get(side, {})
            qs.extend(raw.get("q", []))
            for h in HORIZONS:
                acc[h].extend(raw.get(h, []))
        s: dict = {"n": int(np.isfinite(np.array(acc[20], dtype=float)).sum())}
        for h in HORIZONS:
            a = np.array(acc[h], dtype=float)
            a = a[np.isfinite(a)]
            if a.size >= 20:
                right = a > 0 if side in ("buy", "base") else a < 0
                s[f"hit{h}"] = round(100.0 * float(right.mean()), 1)
                s[f"med{h}"] = round(100.0 * float(np.median(a)), 2)
            else:
                s[f"hit{h}"], s[f"med{h}"] = None, None
        s["qpos"], s["nq"] = _quarter_share(qs, acc[20], side)
        agg[side] = s

    # Mehrwert gegenüber dem Zufall. Bei Verkaufssignalen ist der unbedingte
    # Vergleichswert die Gegenwahrscheinlichkeit; beim Median ist ein tieferer
    # Wert als der Zufall günstig, deshalb wird das Vorzeichen gedreht, damit
    # positiv in beiden Richtungen günstig heisst.
    for side in ("buy", "sell"):
        for h in HORIZONS:
            hit, bh = agg[side].get(f"hit{h}"), agg["base"].get(f"hit{h}")
            med, bm = agg[side].get(f"med{h}"), agg["base"].get(f"med{h}")
            ref_hit = bh if side == "buy" else (None if bh is None else round(100 - bh, 1))
            agg[side][f"ref_hit{h}"] = ref_hit
            agg[side][f"ref_med{h}"] = bm
            agg[side][f"edge_hit{h}"] = (None if hit is None or ref_hit is None
                                         else round(hit - ref_hit, 1))
            if med is None or bm is None:
                agg[side][f"edge_med{h}"] = None
            else:
                agg[side][f"edge_med{h}"] = round(med - bm if side == "buy" else bm - med, 2)
    return agg


def strip_raw(bt: dict) -> dict:
    return {k: v for k, v in bt.items() if k != "_raw"}
