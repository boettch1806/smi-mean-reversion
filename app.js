const ROWS = window.DATA.rows;
const SERIES = window.DATA.series;

const state = { idx: 'all', cold: false, hot: false, q: '', sort: 'z', dir: -1, sel: null };

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (v, d = 2) => v === null || v === undefined ? '–' : v.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt0 = (v) => v === null || v === undefined ? '–' : v.toLocaleString('de-CH', { maximumFractionDigits: 0 });
const sgn = (v, d = 2) => v === null ? '–' : (v > 0 ? '+' : '') + fmt(v, d);
const cls = (r) => r.rsi === null ? 'neutral' : r.rsi < 30 ? 'cold' : r.rsi > 70 ? 'hot' : 'neutral';

/* ---------- filtering ---------- */
function view() {
  let rs = ROWS.filter(r => state.idx === 'all' || r.index === state.idx);
  if (state.cold || state.hot) rs = rs.filter(r => (state.cold && r.rsi !== null && r.rsi < 30) || (state.hot && r.rsi !== null && r.rsi > 70));
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
      <td class="n">${fmt(r.vol1y, 1)} %</td>
      <td class="n">${fmt(r.vol5y, 1)} %</td>
      <td class="n">${fmt0(r.rev_days)}</td>
      <td class="n">${fmt0(r.halflife)}</td>
      <td class="n">${r.episodes || '–'}</td>
    </tr>`).join('');
  document.getElementById('tinfo').textContent = `${rs.length} Titel · Kurse und Kennzahlen per 13.08.2026`;
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
let sc, zb;
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
      datasets: [{ data: zr.map(r => r.z), backgroundColor: zr.map(r => (r.z > 0 ? css('--hot') : css('--cold')) + (Math.abs(r.z) > 1.5 ? 'ee' : '99')), borderRadius: 2, borderSkipped: false, barThickness: 'flex' }]
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

/* ---------- URL state ---------- */
function writeHash() {
  const p = new URLSearchParams();
  if (state.idx !== 'all') p.set('idx', state.idx);
  if (state.cold) p.set('cold', '1');
  if (state.hot) p.set('hot', '1');
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
  state.q = p.get('q') || '';
  if (p.get('sort')) state.sort = p.get('sort');
  if (p.get('dir') === 'asc') state.dir = 1;
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.idx === state.idx)));
  document.getElementById('f-cold').setAttribute('aria-pressed', String(state.cold));
  document.getElementById('f-hot').setAttribute('aria-pressed', String(state.hot));
  document.getElementById('q').value = state.q;
}

/* ---------- CSV export ---------- */
function exportCsv() {
  const cols = [['ticker', 'Ticker'], ['name', 'Titel'], ['index', 'Index'], ['sector', 'Sektor'],
    ['last_date', 'Datum'], ['close', 'Kurs'], ['rsi', 'RSI14'], ['sma200', 'SMA200'],
    ['dist200', 'Abstand_SMA200_Prozent'], ['z', 'ZScore'], ['vol1y', 'Volatilitaet_1J_Prozent'],
    ['vol5y', 'Volatilitaet_5J_Prozent'], ['rev_days', 'Rueckkehrdauer_Tage'],
    ['halflife', 'Halbwertszeit_Tage'], ['episodes', 'Episoden_5J'], ['obs', 'Beobachtungen']];
  const rs = view();
  const lines = [cols.map(c => c[1]).join(';')];
  rs.forEach(r => lines.push(cols.map(c => r[c[0]] === null || r[c[0]] === undefined ? '' : String(r[c[0]])).join(';')));
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mean-reversion-smi-smim-2026-08-13.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- render ---------- */
function render() {
  const rs = view();
  kpis(rs); table(rs); charts(rs); extremes(rs);
  try { writeHash(); } catch (e) { /* sandboxed iframe */ }
}

/* ---------- events ---------- */
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  state.idx = b.dataset.idx;
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  render();
}));
['cold', 'hot'].forEach(k => {
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
document.getElementById('theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  render();
});
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';

document.getElementById('asof').textContent = '13.08.2026';
document.getElementById('count').textContent = ROWS.length;
try { readHash(); } catch (e) { /* ignore */ }
render();
