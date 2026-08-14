const ROWS = window.DATA.rows;
const SERIES = window.DATA.series;
const META = window.DATA.meta || {};
const SIG = META.signal || null;
const HOR = (SIG && SIG.horizons) || [10, 20, 60];
const SIG_W_Z = SIG ? SIG.w_z : 0.65;
const SIG_W_RSI = SIG ? SIG.w_rsi : 0.35;
const SIG_Z_FULL = SIG ? SIG.z_full : 2.5;
const SIG_RSI_FULL = SIG ? SIG.rsi_full : 25;

/* ISO-Datum als TT.MM.JJJJ. Bewusst ohne Date(), damit der Stichtag nicht in
   der Zeitzone des Betrachters um einen Tag verrutscht. */
const deDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || '–');
};

const state = { idx: 'all', cold: false, hot: false, sig: false, q: '', sort: 'z', dir: -1, sel: null, an: false };

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (v, d = 2) => v === null || v === undefined ? '–' : v.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt0 = (v) => v === null || v === undefined ? '–' : v.toLocaleString('de-CH', { maximumFractionDigits: 0 });
const sgn = (v, d = 2) => v === null ? '–' : (v > 0 ? '+' : '') + fmt(v, d);
const cls = (r) => r.rsi === null ? 'neutral' : r.rsi < 30 ? 'cold' : r.rsi > 70 ? 'hot' : 'neutral';
const pp = (v) => v === null || v === undefined ? '–' : (v > 0 ? '+' : '') + fmt(v, 1) + ' Pp';

/* Stufe eines Signal-Scores: Signal, blosse Beobachtung oder nichts. */
const TRIG = SIG ? SIG.trigger : 70;
const WATCH = SIG ? (SIG.watch || 55) : 55;
const tier = (s) => {
  if (s === null || s === undefined) return null;
  const a = Math.abs(s);
  if (a < WATCH) return null;
  return { side: s > 0 ? 'buy' : 'sell', firm: a >= TRIG, strong: a >= (SIG ? SIG.strong : 85) };
};
const hasSignal = (r) => { const t = tier(r.score); return !!(t && t.firm); };

/* ---------- filtering ---------- */
function view() {
  let rs = ROWS.filter(r => state.idx === 'all' || r.index === state.idx);
  if (state.cold || state.hot) rs = rs.filter(r => (state.cold && r.rsi !== null && r.rsi < 30) || (state.hot && r.rsi !== null && r.rsi > 70));
  if (state.sig) rs = rs.filter(hasSignal);
  if (state.q) {
    const q = state.q.toLowerCase();
    rs = rs.filter(r => r.name.toLowerCase().includes(q) || r.ticker.toLowerCase().includes(q));
  }
  const k = state.sort;
  return rs.sort((a, b) => {
    let x = a[k], y = b[k];
    if (typeof x === 'string') return x.localeCompare(y, 'de') * state.dir;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * state.dir;
  });
}

/* ---------- KPIs ---------- */
function kpis(rs) {
  const withRsi = rs.filter(r => r.rsi !== null);
  const cold = withRsi.filter(r => r.rsi < 30);
  const hot = withRsi.filter(r => r.rsi > 70);
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const zs = rs.filter(r => r.z !== null);
  const extreme = zs.slice().sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
  const above = rs.filter(r => r.dist200 !== null && r.dist200 > 0).length;

  const cards = [
    { label: 'Titel im Filter', value: rs.length, sub: `${rs.filter(r => r.index === 'SMI').length} SMI · ${rs.filter(r => r.index === 'SMIM').length} SMIM` },
    { label: 'Überverkauft · RSI < 30', value: cold.length, sub: cold.length ? cold.map(r => r.name).join(', ') : 'kein Titel', k: 'is-cold' },
    { label: 'Überkauft · RSI > 70', value: hot.length, sub: hot.length ? hot.map(r => r.name).join(', ') : 'kein Titel', k: 'is-hot' },
    { label: 'Median RSI 14', value: fmt(med(withRsi.map(r => r.rsi)), 1), sub: `Median Δ SMA 200: ${sgn(med(rs.map(r => r.dist200).filter(v => v !== null)), 1)} %` },
    { label: 'Über der 200-Tage-Linie', value: `${above}/${rs.filter(r => r.dist200 !== null).length}`, sub: 'Titel im Aufwärtsregime' },
    { label: 'Extremster Z-Score', value: extreme ? sgn(extreme.z) : '–', sub: extreme ? extreme.name : '–', k: extreme && extreme.z > 0 ? 'is-hot' : 'is-cold' },
  ];
  document.getElementById('kpis').innerHTML = cards.map(c => `
    <div class="card kpi ${c.k || ''}">
      <div class="label">${c.label}</div>
      <div class="value num">${c.value}</div>
      <div class="sub">${c.sub}</div>
    </div>`).join('');
}

/* ---------- table ---------- */
function zcell(z) {
  if (z === null) return '<span class="dim">–</span>';
  const w = Math.min(Math.abs(z) / 4.2, 1) * 42;
  const col = z > 0 ? 'var(--hot)' : 'var(--cold)';
  return `<span class="zbar"><i style="width:${w.toFixed(0)}px;background:${col}"></i><b style="font-variant-numeric:tabular-nums">${sgn(z)}</b></span>`;
}

function scell(r) {
  if (r.score === null || r.score === undefined) return '<span class="dim">–</span>';
  const t = tier(r.score);
  const k = !t ? '' : t.firm ? (t.side === 'buy' ? 'buy' : 'sell') : 'watch';
  const num = `<b style="font-variant-numeric:tabular-nums">${sgn(r.score, 0)}</b>`;
  return t ? `<span class="pill ${k}" title="${r.sig || ''}">${sgn(r.score, 0)}</span>` : num;
}

function table(rs) {
  document.querySelector('#tbl tbody').innerHTML = rs.map(r => `
    <tr data-t="${r.ticker}" class="${state.sel === r.ticker ? 'sel' : ''}">
      <td class="l"><span class="nm">${r.name}</span> <span class="tick">${r.ticker.replace('.SW', '')}</span>${r.stale ? ' <span class="badge" title="Kursreihe endet am ' + r.last_date + '">Datenlücke</span>' : ''}</td>
      <td class="l"><span class="badge ${r.index === 'SMI' ? 'smi' : ''}">${r.index}</span></td>
      <td class="n">${fmt(r.close, r.close > 5000 ? 0 : 2)}</td>
      <td class="n"><span class="pill ${cls(r)}">${r.rsi === null ? '–' : fmt(r.rsi, 1)}</span></td>
      <td class="n">${fmt(r.sma200, r.close > 5000 ? 0 : 2)}</td>
      <td class="n ${r.dist200 === null ? '' : r.dist200 > 0 ? 'pos' : 'neg'}">${sgn(r.dist200, 1)} %</td>
      <td class="n">${zcell(r.z)}</td>
      <td class="n">${scell(r)}</td>
      <td class="n">${fmt(r.vol1y, 1)} %</td>
      <td class="n">${fmt(r.vol5y, 1)} %</td>
      <td class="n">${fmt0(r.rev_days)}</td>
      <td class="n">${fmt0(r.halflife)}</td>
      <td class="n">${r.episodes || '–'}</td>
    </tr>`).join('');
  document.getElementById('tinfo').textContent = `${rs.length} Titel · Kurse und Kennzahlen per ${deDate(META.asof)}`;
  document.querySelectorAll('#tbl tbody tr').forEach(tr => tr.addEventListener('click', () => {
    state.sel = state.sel === tr.dataset.t ? null : tr.dataset.t;
    render();
  }));
}

/* ---------- extremes ---------- */
let miniCharts = [];
function extremes(rs) {
  miniCharts.forEach(c => c.destroy()); miniCharts = [];
  const top = rs.filter(r => r.z !== null).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 6);
  document.getElementById('ext').innerHTML = top.map(r => `
    <div class="ext">
      <div class="top">
        <strong>${r.name} <span class="tick">${r.ticker.replace('.SW', '')}</span></strong>
        <span class="z" style="color:${r.z > 0 ? 'var(--hot)' : 'var(--cold)'}">Z ${sgn(r.z)}</span>
      </div>
      <div class="chart-box mini"><canvas id="mini-${r.ticker.replace('.', '-')}"></canvas></div>
      <dl>
        <div><dt>Vola 1 Jahr</dt><dd>${fmt(r.vol1y, 1)} %</dd></div>
        <div><dt>Vola 5 Jahre</dt><dd>${fmt(r.vol5y, 1)} %</dd></div>
        <div><dt>Ø Rückkehrdauer</dt><dd>${fmt0(r.rev_days)} Tage</dd></div>
        <div><dt>Halbwertszeit</dt><dd>${fmt0(r.halflife)} Tage</dd></div>
        <div><dt>Δ SMA 200</dt><dd class="${r.dist200 > 0 ? 'pos' : 'neg'}">${sgn(r.dist200, 1)} %</dd></div>
        <div><dt>RSI 14</dt><dd>${fmt(r.rsi, 1)}</dd></div>
      </dl>
    </div>`).join('');

  top.forEach(r => {
    const s = SERIES[r.ticker]; if (!s) return;
    const el = document.getElementById('mini-' + r.ticker.replace('.', '-')); if (!el) return;
    const col = r.z > 0 ? css('--hot') : css('--cold');
    miniCharts.push(new Chart(el, {
      type: 'line',
      data: {
        labels: s.d,
        datasets: [{ data: s.z, borderColor: col, borderWidth: 1.4, pointRadius: 0, fill: true,
          backgroundColor: (c) => { const g = c.chart.ctx.createLinearGradient(0, 0, 0, 116); g.addColorStop(0, col + '33'); g.addColorStop(1, col + '00'); return g; }, tension: .2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { displayColors: false, callbacks: { label: (c) => 'Z ' + c.parsed.y.toFixed(2) } }
        },
        scales: {
          x: { display: false },
          y: { grid: { color: css('--divider') }, border: { display: false },
               ticks: { color: css('--text-faint'), font: { size: 9 }, maxTicksLimit: 3 } }
        }
      }
    }));
  });
}

/* ---------- charts ---------- */
let sc, zb, dch;
let detYrs = 0;  // 0 = ganzer Zeitraum, sonst Jahre
function charts(rs) {
  const mk = (r) => ({ x: r.dist200, y: r.rsi, r: 4 + Math.min(Math.abs(r.z || 0), 4.2) * 3.2, row: r });
  const pick = (k) => rs.filter(r => r.rsi !== null && r.dist200 !== null && cls(r) === k).map(mk);
  const sets = [
    { label: 'überverkauft', data: pick('cold'), color: css('--cold') },
    { label: 'überkauft', data: pick('hot'), color: css('--hot') },
    { label: 'neutral', data: pick('neutral'), color: css('--text-faint') },
  ];
  const tip = {
    displayColors: false,
    callbacks: {
      title: (c) => c[0].raw.row.name + ' (' + c[0].raw.row.index + ')',
      label: (c) => { const r = c.raw.row; return ['RSI 14: ' + fmt(r.rsi, 1), 'Δ SMA 200: ' + sgn(r.dist200, 1) + ' %', 'Z-Score: ' + sgn(r.z), 'Vola 1J: ' + fmt(r.vol1y, 1) + ' %']; }
    }
  };

  if (sc) sc.destroy();
  sc = new Chart(document.getElementById('scatter'), {
    type: 'bubble',
    data: { datasets: sets.map(s => ({ label: s.label, data: s.data, backgroundColor: s.color + '30', borderColor: s.color, borderWidth: 1.4 })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false }, tooltip: tip,
        annotationLines: true
      },
      scales: {
        x: { title: { display: true, text: 'Abstand zur 200-Tage-Linie in %', color: css('--text-muted'), font: { size: 11 } },
             grid: { color: css('--divider') }, border: { color: css('--border') },
             ticks: { color: css('--text-faint'), font: { size: 10 }, callback: (v) => v + '%' } },
        y: { min: 20, max: 90, title: { display: true, text: 'RSI 14', color: css('--text-muted'), font: { size: 11 } },
             grid: { color: css('--divider') }, border: { color: css('--border') },
             ticks: { color: css('--text-faint'), font: { size: 10 }, stepSize: 10 } }
      }
    },
    plugins: [{
      id: 'zones',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales } = chart;
        [[30, css('--cold')], [70, css('--hot')]].forEach(([lvl, col]) => {
          const y = scales.y.getPixelForValue(lvl);
          ctx.save();
          ctx.strokeStyle = col; ctx.globalAlpha = .5; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
          ctx.globalAlpha = 1; ctx.setLineDash([]);
          ctx.fillStyle = col; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'left';
          ctx.fillText(lvl === 30 ? 'überverkauft 30' : 'überkauft 70', a.left + 4, y + (lvl === 30 ? 12 : -5));
          ctx.restore();
        });
        const x0 = scales.x.getPixelForValue(0);
        ctx.save(); ctx.strokeStyle = css('--border'); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, a.top); ctx.lineTo(x0, a.bottom); ctx.stroke(); ctx.restore();
      }
    }]
  });

  const zr = rs.filter(r => r.z !== null).sort((a, b) => b.z - a.z);
  if (zb) zb.destroy();
  zb = new Chart(document.getElementById('zbars'), {
    type: 'bar',
    data: {
      labels: zr.map(r => r.name.length > 17 ? r.name.slice(0, 16) + '…' : r.name),
      datasets: [{ data: zr.map(r => r.z), backgroundColor: zr.map(r => (r.z > 0 ? css('--hot') : css('--cold')) + (Math.abs(r.z) > 1.5 ? 'ee' : '99')), borderRadius: 2, borderSkipped: false, barThickness: 'flex', maxBarThickness: 22 }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, callbacks: { label: (c) => { const r = zr[c.dataIndex]; return ['Z-Score: ' + sgn(r.z), 'RSI 14: ' + fmt(r.rsi, 1), 'Ø Rückkehr: ' + fmt0(r.rev_days) + ' Tage']; } } }
      },
      scales: {
        x: { grid: { color: css('--divider') }, border: { display: false }, ticks: { color: css('--text-faint'), font: { size: 10 } } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: css('--text-muted'), font: { size: 9.5 }, autoSkip: false } }
      }
    }
  });
  document.querySelector('#zbars').parentElement.style.height = Math.max(320, zr.length * 15 + 40) + 'px';
}

/* ---------- Signalauswertung ----------
   Alle Zahlen stammen aus dem Rückwärtstest im nächtlichen Lauf. Das Urteil wird
   aus den Messwerten abgeleitet und nicht fest geschrieben, damit es sich mit
   neuen Daten von selbst korrigiert. */
function verdict(side) {
  const a = SIG.agg[side], b = SIG.agg.base;
  const edge = a.edge_hit20;
  const refQ = side === 'buy' ? b.qpos : (b.qpos === null ? null : 100 - b.qpos);
  const qOk = a.qpos !== null && refQ !== null && a.qpos - refQ >= 8;
  if (edge === null) return { k: 'no', t: 'nicht messbar', w: 'Zu wenige Ereignisse für eine Aussage.' };
  if (edge >= 5 && qOk) return { k: 'ok', t: 'schwach bestätigt', w: 'Der Vorsprung zeigt sich über viele Quartale und nicht nur in einer Marktphase.' };
  if (edge >= 5) return { k: 'no', t: 'nicht bestätigt', w: 'Der Vorsprung stammt aus wenigen Quartalen und ist damit eine Wette auf einzelne Marktphasen.' };
  return { k: 'no', t: 'nicht bestätigt', w: 'Kein nennenswerter Vorsprung gegenüber einem beliebigen Handelstag.' };
}

function histTable(side) {
  const a = SIG.agg[side], b = SIG.agg.base;
  const dirWord = side === 'buy' ? 'gestiegen' : 'gefallen';
  const refQ = side === 'buy' ? b.qpos : (b.qpos === null ? null : 100 - b.qpos);
  const rows = HOR.map(h => {
    const e = a['edge_hit' + h], em = a['edge_med' + h];
    const k = (v) => v === null ? '' : v > 0 ? 'pos' : 'neg';
    return `<tr>
      <td>${h} Tage</td>
      <td>${a['hit' + h] === null ? '–' : fmt(a['hit' + h], 1) + ' %'}</td>
      <td class="dim">${a['ref_hit' + h] === null ? '–' : fmt(a['ref_hit' + h], 1) + ' %'}</td>
      <td class="edge ${k(e)}">${pp(e)}</td>
      <td>${a['med' + h] === null ? '–' : sgn(a['med' + h], 2) + ' %'}</td>
      <td class="dim">${a['ref_med' + h] === null ? '–' : sgn(a['ref_med' + h], 2) + ' %'}</td>
      <td class="edge ${k(em)}">${pp(em)}</td>
    </tr>`;
  }).join('');
  return `<div class="sig-t">
    <h4>${side === 'buy' ? 'Kaufsignale' : 'Verkaufssignale'} · ${fmt0(a.n)} Ereignisse</h4>
    <table>
      <thead><tr><th>Horizont</th><th>Kurs ${dirWord}</th><th>Zufall</th><th>Mehrwert</th><th>Median</th><th>Zufall</th><th>Mehrwert</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="7">Quartale, in denen die Mehrheit der Signale nach 20 Tagen richtig lag:
        ${a.qpos === null ? '–' : fmt(a.qpos, 0) + ' % von ' + a.nq}, Zufall ${refQ === null ? '–' : fmt(refQ, 0) + ' %'}</td></tr></tfoot>
    </table>
  </div>`;
}

function analysis() {
  const box = document.getElementById('analysis');
  const btn = document.getElementById('btn-analyse');
  if (!SIG) { btn.hidden = true; box.hidden = true; return; }
  box.hidden = !state.an;
  btn.setAttribute('aria-expanded', String(state.an));
  if (!state.an) return;

  const a = SIG.agg;
  document.getElementById('sig-sub').textContent =
    `Score ab ${SIG.trigger} gilt als Signal, ab ${SIG.strong} als deutlich · gemessen an ${SIG.tested} Titeln `
    + `mit ${fmt0(a.buy.n)} Kauf- und ${fmt0(a.sell.n)} Verkaufsereignissen der letzten fünf Jahre`;

  document.getElementById('sig-verdict').innerHTML = ['buy', 'sell'].map(s => {
    const v = verdict(s);
    return `<div class="sig-v ${v.k}"><b>${s === 'buy' ? 'Kaufseite' : 'Verkaufsseite'}: ${v.t}</b>
      <span>${pp(SIG.agg[s].edge_hit20)} Trefferquote gegenüber dem Zufall auf 20 Tage. ${v.w}</span></div>`;
  }).join('');

  const now = ROWS.filter(r => tier(r.score)).sort((x, y) => Math.abs(y.score) - Math.abs(x.score));
  document.getElementById('sig-now').innerHTML = now.length ? now.map(r => {
    const t = tier(r.score);
    return `<div class="sig-c ${t.side}">
      <div class="hd"><span class="nm">${r.name}</span><span class="sc">${sgn(r.score, 0)}</span></div>
      <div><span class="pill ${t.firm ? t.side : 'watch'}">${r.sig}</span></div>
      <div class="kv">Z ${sgn(r.z)} · RSI ${fmt(r.rsi, 1)} · Δ SMA 200 ${sgn(r.dist200, 1)}&nbsp;%</div>
      <div class="kv">Ø Rückkehr ${fmt0(r.rev_days)} Tage · Vola 1 J ${fmt(r.vol1y, 1)}&nbsp;%</div>
    </div>`;
  }).join('') : '<p class="sig-note">Kein Titel erreicht derzeit die Schwelle.</p>';

  document.getElementById('sig-scope').textContent =
    'Gezählt wird jeder Eintritt in ein Signal, nicht jeder Tag darin. Die Spalte Zufall zeigt, '
    + 'was ein beliebiger Handelstag desselben Titels im selben Zeitraum geliefert hätte. '
    + 'Aussagekräftig ist nur die Differenz.';
  document.getElementById('sig-hist').innerHTML = histTable('buy') + histTable('sell');

  const thin = ROWS.filter(r => r.bt && r.bt.buy && r.bt.buy.thin).length;
  const withBt = ROWS.filter(r => r.bt).length;
  document.getElementById('sig-warn').innerHTML = `<b>Was diese Zahlen nicht können</b>
    <ul>
      <li>Bei ${thin} von ${withBt} Titeln liegen weniger als ${SIG.min_events} Kaufereignisse in fünf Jahren. Eine titelspezifische Trefferquote ist dort nicht belastbar; belastbar ist nur der titelübergreifende Wert.</li>
      <li>Der Testzeitraum umfasst fünf Jahre eines überwiegend steigenden Marktes. Deshalb steht neben jeder Quote der unbedingte Vergleichswert – ohne ihn wirkt jede Kaufquote gut.</li>
      <li>Dividenden sind nicht eingerechnet. Die gemessenen Vorwärtsrenditen liegen damit unter den tatsächlichen.</li>
      <li>Die Messfenster überlappen sich, und mehrere Schwellen wurden geprüft. Beides lässt einen gefundenen Vorsprung zufälliger erscheinen, als eine einzelne Zahl vermuten lässt.</li>
      <li>Ein Signal ist eine statistische Auffälligkeit, kein Anlageratschlag. Über den Anlass der Bewegung sagt es nichts.</li>
    </ul>`;
}

/* ---------- Titeldetail ---------- */
function detail() {
  const box = document.getElementById('detail');
  const r = ROWS.find(x => x.ticker === state.sel);
  if (!r) {
    box.hidden = true;
    if (dch) { dch.destroy(); dch = null; }
    return;
  }
  box.hidden = false;
  document.getElementById('det-title').textContent = `${r.name} · ${r.ticker.replace('.SW', '')}`;
  document.getElementById('det-sub').textContent =
    `${r.index} · ${r.sector} · Kurs ${fmt(r.close, r.close > 5000 ? 0 : 2)} CHF per ${deDate(r.last_date)}`;

  const t = tier(r.score);
  const zPart = r.z === null ? null : Math.round(100 * SIG_W_Z * Math.max(-1, Math.min(1, -r.z / SIG_Z_FULL)));
  const rPart = r.rsi === null ? null : Math.round(100 * SIG_W_RSI * Math.max(-1, Math.min(1, (50 - r.rsi) / SIG_RSI_FULL)));

  const scoreBox = `<div class="det-box">
    <h4>Signal</h4>
    <dl>
      <div><dt>Signal-Score</dt><dd>${r.score === null ? '–' : sgn(r.score, 0)}</dd></div>
      <div><dt>Einstufung</dt><dd>${r.sig || '–'}</dd></div>
      <div><dt>davon aus Z-Score</dt><dd>${zPart === null ? '–' : sgn(zPart, 0)}</dd></div>
      <div><dt>davon aus RSI</dt><dd>${rPart === null ? '–' : sgn(rPart, 0)}</dd></div>
      <div><dt>Schwelle für ein Signal</dt><dd>±${TRIG}</dd></div>
    </dl>
  </div>`;

  const kennBox = `<div class="det-box">
    <h4>Kennzahlen</h4>
    <dl>
      <div><dt>RSI 14</dt><dd>${fmt(r.rsi, 1)}</dd></div>
      <div><dt>Δ SMA 200</dt><dd>${sgn(r.dist200, 1)} %</dd></div>
      <div><dt>Z-Score</dt><dd>${sgn(r.z)}</dd></div>
      <div><dt>Vola 1 J / 5 J</dt><dd>${fmt(r.vol1y, 1)} % / ${fmt(r.vol5y, 1)} %</dd></div>
      <div><dt>Ø Rückkehrdauer</dt><dd>${fmt0(r.rev_days)} Tage</dd></div>
      <div><dt>Halbwertszeit</dt><dd>${fmt0(r.halflife)} Tage</dd></div>
    </dl>
  </div>`;

  let btBox = '<div class="det-box"><h4>Historischer Verlauf nach Signalen</h4>'
    + '<p class="sig-note">Für diesen Titel liegt kein Rückwärtstest vor, meist wegen zu kurzer Kurshistorie.</p></div>';
  if (r.bt && SIG) {
    const side = (t && t.side) || 'buy';
    const s = r.bt[side], b = r.bt.base;
    const pooled = SIG.agg[side];
    const refHit = (h) => side === 'buy' ? b['hit' + h] : (b['hit' + h] === null ? null : 100 - b['hit' + h]);
    const thin = !s || s.thin;
    const rows = HOR.map(h => {
      const own = s ? s['hit' + h] : null;
      return `<div class="row"><span class="dim">${h} Tage</span>
        <span class="track">
          ${own === null ? '' : `<i style="left:0;width:${own}%;background:var(--${side === 'buy' ? 'cold' : 'hot'})"></i>`}
          ${refHit(h) === null ? '' : `<i style="left:${refHit(h)}%;width:2px;background:var(--text)"></i>`}
        </span>
        <span style="text-align:right;font-variant-numeric:tabular-nums">${own === null ? '–' : fmt(own, 0) + ' %'}</span></div>`;
    }).join('');
    btBox = `<div class="det-box">
      <h4>Historischer Verlauf nach ${side === 'buy' ? 'Kauf' : 'Verkauf'}signalen dieses Titels</h4>
      <dl>
        <div><dt>Signaleintritte seit ${deDate(r.bt.from)}</dt><dd>${s ? fmt0(s.n) : '–'}</dd></div>
        <div><dt>Median nach 20 Tagen</dt><dd>${s && s.med20 !== null ? sgn(s.med20) + ' %' : '–'}</dd></div>
        <div><dt>Zufall nach 20 Tagen</dt><dd>${b.med20 === null ? '–' : sgn(b.med20) + ' %'}</dd></div>
        ${side === 'buy' && s && s.dd20 !== null && s.dd20 !== undefined ? `<div><dt>Median tiefster Punkt</dt><dd>${sgn(s.dd20)} %</dd></div>` : ''}
      </dl>
      <div class="det-bar">${rows}</div>
      <p class="sig-note" style="margin-top:.5rem">Balken: Anteil der Fälle, in denen der Kurs anschliessend
        ${side === 'buy' ? 'gestiegen' : 'gefallen'} ist. Der senkrechte Strich markiert den Zufallswert dieses Titels.</p>
      ${thin ? `<p class="sig-note" style="margin-top:.5rem"><b>Zu wenige Ereignisse.</b> Mit ${s ? s.n_eval : 0}
        auswertbaren Signalen ist die titelspezifische Quote nicht belastbar. Titelübergreifend lag die Quote auf
        20 Tage bei ${pooled.hit20 === null ? '–' : fmt(pooled.hit20, 1) + ' %'} gegen ${pooled.ref_hit20 === null ? '–' : fmt(pooled.ref_hit20, 1) + ' %'}
        Zufall, also ${pp(pooled.edge_hit20)}.</p>` : ''}
    </div>`;
  }
  document.getElementById('det-body').innerHTML =
    `<div class="det-grid">${scoreBox}${kennBox}${btBox}</div>`;
  detailChart(r);
}

/* Verlauf des mitlaufenden Scores mit den einzelnen Signaleintritten. Der Score
   liegt auf demselben wochenweisen Raster wie Kurs und Z-Score; die Eintritte
   stammen aus den Tagesdaten und werden auf den nächstgelegenen Rasterpunkt
   gesetzt, damit auch kurze Signale sichtbar bleiben. */
function detailChart(r) {
  const wrap = document.querySelector('#detail .det-chart');
  const note = document.getElementById('det-chart-note');
  const head = document.getElementById('det-chart-h');
  const s = SERIES[r.ticker];
  if (dch) { dch.destroy(); dch = null; }
  if (!s || !s.s) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  // Rasterindex zu einem Tagesdatum, gerundet auf den nächstgelegenen Punkt.
  const idxOf = (iso) => {
    let lo = 0, hi = s.d.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (s.d[m] < iso) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(Date.parse(s.d[lo]) - Date.parse(iso)) > Math.abs(Date.parse(iso) - Date.parse(s.d[lo - 1]))) lo -= 1;
    return lo;
  };

  // Gewählter Zeitraum. 0 heisst alles, sonst die letzten n Jahre.
  const last = s.d[s.d.length - 1];
  let i0 = 0;
  if (detYrs) {
    const from = (Number(last.slice(0, 4)) - detYrs) + last.slice(4);
    i0 = Math.min(idxOf(from), s.d.length - 12);
  }
  const D = s.d.slice(i0), P = s.p.slice(i0), S = s.s.slice(i0);
  const M = (s.m || []).slice(i0), Z = (s.z || []).slice(i0);
  const ev = (s.ev || []).filter(e => e[0] >= D[0]);
  head.textContent = detYrs
    ? `Signalverlauf der letzten ${detYrs === 1 ? 'zw\u00f6lf Monate' : detYrs + ' Jahre'}`
    : 'Signalverlauf seit ' + deDate(D[0]);

  const mkPts = (side) => {
    const a = new Array(D.length).fill(null);
    ev.filter(e => e[1] === side).forEach(e => {
      const i = idxOf(e[0]) - i0;
      if (i < 0 || i >= a.length) return;
      if (a[i] === null || Math.abs(e[2]) > Math.abs(a[i])) a[i] = e[2];
    });
    return a;
  };
  const evAt = {};
  ev.forEach(e => { const i = idxOf(e[0]) - i0; if (i >= 0) (evAt[i] = evAt[i] || []).push(e); });

  const nBuy = ev.filter(e => e[1] === 1).length;
  const nSell = ev.length - nBuy;
  const gap = Math.round((Date.parse(META.asof) - Date.parse(last)) / 86400000);
  note.textContent =
    (ev.length
      ? `${nBuy} Kauf- und ${nSell} Verkaufseintritte in diesem Zeitraum. Die Dreiecke zeigen den Tag, `
        + 'an dem der Score die Schwelle erstmals \u00fcberschritt; ein durchgehendes Signal wird nur einmal gez\u00e4hlt. '
      : 'In diesem Zeitraum hat der Score keine der beiden Schwellen neu \u00fcberschritten. ')
    + 'Die Kurve zeigt den mitlaufenden Score aus dem R\u00fcckw\u00e4rtstest, der keine k\u00fcnftigen Kurse kennt, '
    + 'weshalb er am rechten Rand leicht von der Tabellenzahl abweichen kann'
    + (gap > 1 ? `; sie endet am ${deDate(last)}, also ${gap} Tage vor dem Stichtag.` : '.');

  const line = css('--text'), faint = css('--text-faint');
  const cold = css('--cold'), hot = css('--hot');
  const narrow = window.innerWidth < 720;
  // Jahreszahlen nur setzen, wenn genug Rasterpunkte dazwischen liegen, sonst
  // kleben zwei Beschriftungen aneinander. Bei einem kurzen Zeitraum reicht das
  // Jahr nicht, dann werden Monate gesetzt.
  const MON = ['Jan', 'Feb', 'M\u00e4r', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const xTick = new Array(D.length).fill('');
  const minGap = narrow ? 9 : 4;
  let lastAt = -99;
  D.forEach((iso, i) => {
    if (i === 0) return;
    const prev = D[i - 1];
    if (detYrs === 1) {
      if (iso.slice(5, 7) === prev.slice(5, 7)) return;
      const step = narrow ? 3 : 2;
      if (Number(iso.slice(5, 7)) % step !== 1) return;
      if (i - lastAt < 3) return;
      xTick[i] = MON[Number(iso.slice(5, 7)) - 1] + (iso.slice(5, 7) === '01' ? ' ' + iso.slice(2, 4) : '');
    } else {
      if (iso.slice(0, 4) === prev.slice(0, 4)) return;
      if (i - lastAt < minGap) return;
      xTick[i] = iso.slice(0, 4);
    }
    lastAt = i;
  });

  // Letzter gültiger Score für die Marke am rechten Rand.
  let nowI = -1;
  for (let i = S.length - 1; i >= 0; i--) { if (S[i] !== null) { nowI = i; break; } }

  dch = new Chart(document.getElementById('det-chart-c'), {
    type: 'line',
    data: {
      labels: D,
      datasets: [
        { label: 'Kurs', data: P, yAxisID: 'y1', borderColor: faint, borderWidth: 1.2,
          pointRadius: 0, tension: .3, order: 4 },
        { label: 'Score', data: S, yAxisID: 'y', borderColor: line, borderWidth: 1.7,
          pointRadius: 0, tension: .2, spanGaps: false, order: 3 },
        { label: 'Kaufeintritt', data: mkPts(1), yAxisID: 'y', showLine: false,
          pointStyle: 'triangle', pointRadius: narrow ? 4.5 : 6, pointRotation: 0,
          backgroundColor: cold, borderColor: css('--surface'), borderWidth: 1, order: 1 },
        { label: 'Verkaufseintritt', data: mkPts(-1), yAxisID: 'y', showLine: false,
          pointStyle: 'triangle', pointRadius: narrow ? 4.5 : 6, pointRotation: 180,
          backgroundColor: hot, borderColor: css('--surface'), borderWidth: 1, order: 1 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 260 },
      layout: { padding: { right: narrow ? 2 : 10 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false, padding: 9,
          callbacks: {
            title: (c) => deDate(D[c[0].dataIndex]),
            label: (c) => {
              if (c.datasetIndex > 1) return null;
              return c.datasetIndex === 0 ? 'Kurs: ' + fmt(c.parsed.y, c.parsed.y > 5000 ? 0 : 2) + ' CHF'
                : 'Score: ' + sgn(c.parsed.y, 0);
            },
            afterBody: (c) => {
              const i = c[0].dataIndex;
              const out = [];
              if (Z[i] !== null && Z[i] !== undefined) out.push('Z-Score: ' + sgn(Z[i]));
              if (M[i]) out.push('\u0394 SMA 200: ' + sgn((P[i] / M[i] - 1) * 100, 1) + ' %');
              (evAt[i] || []).forEach(e => out.push(
                `${e[1] === 1 ? 'Kaufeintritt' : 'Verkaufseintritt'} ${deDate(e[0])}, Score ${sgn(e[2], 0)}`
                + (e[3] === null ? ', 20 Tage danach unbekannt' : `, 20 Tage danach ${sgn(e[3], 1)} %`)));
              return out;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { color: css('--border') },
             ticks: { color: faint, font: { size: 10 }, maxRotation: 0, autoSkip: false,
                      callback: (v, i) => xTick[i] || '' } },
        y: { min: -108, max: 108, position: 'left',
             title: { display: !narrow, text: 'Signal-Score', color: css('--text-muted'), font: { size: 11 } },
             grid: { color: css('--divider') }, border: { color: css('--border') },
             afterBuildTicks: (ax) => { ax.ticks = [-100, -70, 0, 70, 100].map(value => ({ value })); },
             ticks: { color: faint, font: { size: 10 } } },
        y1: { position: 'right', grid: { display: false }, border: { color: css('--border') },
              title: { display: !narrow, text: 'Kurs in CHF', color: css('--text-faint'), font: { size: 11 } },
              ticks: { color: faint, font: { size: 10 }, maxTicksLimit: 5 } }
      }
    },
    plugins: [{
      // Signalzonen hinterlegen, Schwellen beschriften und den aktuellen Stand
      // am rechten Rand markieren.
      id: 'sigzones',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales } = chart;
        ctx.save();
        const yTop = scales.y.getPixelForValue(108), yUp = scales.y.getPixelForValue(TRIG);
        const yLo = scales.y.getPixelForValue(-TRIG), yBot = scales.y.getPixelForValue(-108);
        ctx.globalAlpha = .09;
        ctx.fillStyle = cold; ctx.fillRect(a.left, yTop, a.width, yUp - yTop);
        ctx.fillStyle = hot; ctx.fillRect(a.left, yLo, a.width, yBot - yLo);
        ctx.globalAlpha = 1;
        const y0 = scales.y.getPixelForValue(0);
        ctx.strokeStyle = css('--divider'); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.left, y0); ctx.lineTo(a.right, y0); ctx.stroke();
        [[TRIG, cold, 'Kaufsignal ab ' + TRIG], [-TRIG, hot, 'Verkaufssignal ab \u2212' + TRIG]].forEach(([lvl, col, txt]) => {
          const y = scales.y.getPixelForValue(lvl);
          ctx.strokeStyle = col; ctx.globalAlpha = .5; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
          ctx.globalAlpha = 1; ctx.setLineDash([]);
          if (a.width < 480) return;
          // Die Beschriftung erhält eine Fläche in Flächenfarbe, damit sie
          // nicht mit der Kurve verschmilzt.
          ctx.font = '600 10px ' + css('--sans');
          const w = ctx.measureText(txt).width;
          const ty = y + (lvl > 0 ? -6 : 13);
          ctx.fillStyle = css('--surface'); ctx.globalAlpha = .85;
          ctx.fillRect(a.left + 2, ty - 8, w + 8, 12);
          ctx.globalAlpha = 1;
          ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.fillText(txt, a.left + 6, ty + 1);
        });
        ctx.restore();
      },
      afterDatasetsDraw(chart) {
        if (nowI < 0) return;
        const { ctx, chartArea: a, scales } = chart;
        const x = scales.x.getPixelForValue(nowI), y = scales.y.getPixelForValue(S[nowI]);
        const col = Math.abs(S[nowI]) >= TRIG ? (S[nowI] > 0 ? cold : hot) : css('--text-muted');
        ctx.save();
        ctx.strokeStyle = col; ctx.globalAlpha = .35; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(a.right, y); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        // Am letzten Punkt steht oft schon ein Eintrittsdreieck, dann ist ein
        // zweiter Punkt überflüssig.
        if (!evAt[nowI]) {
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
        }
        if (a.width >= 480) {
          const txt = sgn(S[nowI], 0);
          ctx.font = '650 10px ' + css('--sans');
          const w = ctx.measureText(txt).width;
          // Rechts vom Punkt, falls dort Platz ist, sonst links davon. Senkrecht
          // in die Fläche hinein, damit die Zahl nicht am Rand klebt.
          const tx = x + 12 + w <= a.right ? x + 12 : x - w - 12;
          const ty = Math.min(Math.max(y - 5, a.top + 11), a.bottom - 3);
          ctx.fillStyle = css('--surface'); ctx.globalAlpha = .9;
          ctx.fillRect(tx - 3, ty - 10, w + 6, 12);
          ctx.globalAlpha = 1; ctx.fillStyle = col;
          ctx.textAlign = 'left'; ctx.fillText(txt, tx, ty);
        }
        ctx.restore();
      }
    }]
  });
}

/* ---------- URL state ---------- */
function writeHash() {
  const p = new URLSearchParams();
  if (state.idx !== 'all') p.set('idx', state.idx);
  if (state.cold) p.set('cold', '1');
  if (state.hot) p.set('hot', '1');
  if (state.sig) p.set('sig', '1');
  if (state.an) p.set('an', '1');
  if (state.sel) p.set('sel', state.sel);
  if (state.q) p.set('q', state.q);
  if (state.sort !== 'z') p.set('sort', state.sort);
  if (state.dir !== -1) p.set('dir', 'asc');
  const s = p.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('idx')) state.idx = p.get('idx');
  state.cold = p.get('cold') === '1';
  state.hot = p.get('hot') === '1';
  state.sig = p.get('sig') === '1';
  state.an = p.get('an') === '1';
  if (p.get('sel')) state.sel = p.get('sel');
  state.q = p.get('q') || '';
  if (p.get('sort')) state.sort = p.get('sort');
  if (p.get('dir') === 'asc') state.dir = 1;
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.idx === state.idx)));
  document.getElementById('f-cold').setAttribute('aria-pressed', String(state.cold));
  document.getElementById('f-hot').setAttribute('aria-pressed', String(state.hot));
  document.getElementById('f-sig').setAttribute('aria-pressed', String(state.sig));
  document.getElementById('q').value = state.q;
}

/* ---------- CSV export ---------- */
function exportCsv() {
  const cols = [['ticker', 'Ticker'], ['name', 'Titel'], ['index', 'Index'], ['sector', 'Sektor'],
    ['last_date', 'Datum'], ['close', 'Kurs'], ['rsi', 'RSI14'], ['sma200', 'SMA200'],
    ['dist200', 'Abstand_SMA200_Prozent'], ['z', 'ZScore'], ['vol1y', 'Volatilitaet_1J_Prozent'],
    ['vol5y', 'Volatilitaet_5J_Prozent'], ['rev_days', 'Rueckkehrdauer_Tage'],
    ['halflife', 'Halbwertszeit_Tage'], ['episodes', 'Episoden_5J'], ['obs', 'Beobachtungen'],
    ['score', 'SignalScore'], ['sig', 'Einstufung']];
  const rs = view();
  const lines = [cols.map(c => c[1]).join(';')];
  rs.forEach(r => lines.push(cols.map(c => r[c[0]] === null || r[c[0]] === undefined ? '' : String(r[c[0]])).join(';')));
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mean-reversion-smi-smim-${(META.asof || 'export')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- render ---------- */
function render() {
  const rs = view();
  kpis(rs); table(rs); charts(rs); extremes(rs); analysis(); detail();
  try { writeHash(); } catch (e) { /* sandboxed iframe */ }
}

/* ---------- events ---------- */
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  state.idx = b.dataset.idx;
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  render();
}));
['cold', 'hot', 'sig'].forEach(k => {
  const el = document.getElementById('f-' + k);
  el.addEventListener('click', () => { state[k] = !state[k]; el.setAttribute('aria-pressed', String(state[k])); render(); });
});
document.getElementById('q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
document.querySelectorAll('#tbl thead button').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.k;
  if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = (k === 'name' || k === 'index') ? 1 : -1; }
  render();
}));
document.getElementById('csv').addEventListener('click', exportCsv);
document.getElementById('btn-analyse').addEventListener('click', () => {
  state.an = !state.an;
  render();
  if (state.an) document.getElementById('analysis').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('det-close').addEventListener('click', () => { state.sel = null; render(); });

// Zeitraum des Signalverlaufs. Nur der Chart wird neu gezeichnet, der Rest der
// Ansicht bleibt stehen.
document.querySelectorAll('.det-range button').forEach(b => {
  b.addEventListener('click', () => {
    detYrs = Number(b.dataset.yrs);
    document.querySelectorAll('.det-range button').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    const r = ROWS.find(x => x.ticker === state.sel);
    if (r) detailChart(r);
  });
});
document.getElementById('theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  render();
});
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';

document.getElementById('asof').textContent = deDate(META.asof);
document.getElementById('asof2').textContent = deDate(META.asof);
document.getElementById('count').textContent = ROWS.length;
if (META.source) document.getElementById('src').textContent = META.source;
if (SIG) {
  document.getElementById('m-wz').textContent = fmt(SIG.w_z, 2);
  document.getElementById('m-wr').textContent = fmt(SIG.w_rsi, 2);
  document.getElementById('m-trig').textContent = SIG.trigger;
  document.getElementById('m-zw').textContent = fmt0(SIG.z_window);
}
if (META.generated) {
  const g = new Date(META.generated);
  document.getElementById('gen').textContent = isNaN(g) ? META.generated
    : g.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
}
try { readHash(); } catch (e) { /* ignore */ }
render();
