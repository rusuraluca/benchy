const app = document.getElementById('app');
const suiteEl = document.getElementById('suite-name');

const fmt = {
  usd: (n) => (n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`),
  ms: (n) =>
    n >= 1000
      ? `${(n / 1000).toFixed(2)}s`
      : n >= 100
        ? `${n.toFixed(0)}ms`
        : n > 0
          ? `${n.toFixed(1)}ms`
          : '-',
  pct: (r) => `${Math.round(r * 100)}%`,
  date: (iso) => iso.slice(0, 19).replace('T', ' '),
  trunc: (s, n = 220) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`),
  esc: (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    ),
  json: (v) => (v === undefined ? '—' : JSON.stringify(v, null, 2)),
};

function badge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function sparkline(values, color = '#5fc3e7') {
  const w = 260;
  const h = 56;
  const pad = 4;
  if (!values.length) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const x = (i) => pad + (i / Math.max(values.length - 1, 1)) * (w - 2 * pad);
  const y = (v) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `<polygon points="${pad},${h - pad} ${pts} ${w - pad},${h - pad}" fill="${color}" opacity="0.10"/>`;
  return `<svg viewBox="0 0 ${w} ${h}">${area}<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

async function api(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

async function overview() {
  const data = await api('/api/overview');
  suiteEl.textContent = data.suiteName ?? 'benchy';
  const runs = data.runs;
  const last = runs[0];
  const totalCost = runs.reduce((acc, r) => acc + r.summary.totalCostUsd, 0);

  app.innerHTML = `
    <div class="grid-stats">
      <div class="stat"><div class="label">runs</div><div class="value">${runs.length}</div></div>
      <div class="stat">
        <div class="label">latest label</div>
        <div class="value">${fmt.esc(last ? last.label : '—')}</div>
        <div class="hint">${last ? badge(last.status) : 'seed with benchy init-demo'}</div>
      </div>
      <div class="stat">
        <div class="label">pass rate</div>
        <div class="value">${fmt.pct(last ? last.summary.passRate : 0)}</div>
        <div class="hint">latest run</div>
      </div>
      <div class="stat"><div class="label">total spend</div><div class="value">${fmt.usd(totalCost)}</div><div class="hint">${runs.length} runs</div></div>
      <div class="stat"><div class="label">p50 latency</div><div class="value">${fmt.ms(last ? last.summary.p50LatencyMs : 0)}</div><div class="hint">latest run</div></div>
    </div>

    <div class="panel">
      <h2>trends</h2>
      <div class="charts">
        <div class="chart"><div class="title">pass rate %</div><div class="last">${fmt.pct(last ? last.summary.passRate : 0)}</div>${sparkline(
          data.series.passRate.map((p) => p.value),
          '#3ecf8e',
        )}</div>
        <div class="chart"><div class="title">p50 latency ms</div><div class="last">${fmt.ms(last ? last.summary.p50LatencyMs : 0)}</div>${sparkline(
          data.series.latencyP50.map((p) => p.value),
          '#5fc3e7',
        )}</div>
        <div class="chart"><div class="title">cost per run $</div><div class="last">${fmt.usd(last ? last.summary.totalCostUsd : 0)}</div>${sparkline(
          data.series.costUsd.map((p) => p.value),
          '#bc8cff',
        )}</div>
        <div class="chart"><div class="title">duration sec</div><div class="last">${last ? (last.summary.durationMs / 1000).toFixed(1) : '-'}s</div>${sparkline(
          data.series.durationSec.map((p) => p.value),
          '#e3b341',
        )}</div>
      </div>
    </div>

    <div class="panel">
      <h2>recent runs</h2>
      ${runs.length === 0 ? '<div class="empty">no runs yet — run <code>benchy run</code>, <code>benchy init-demo</code>, or just <code>docker compose up</code></div>' : ''}
      <table>
        <thead><tr><th>label</th><th>started</th><th>status</th><th>pass</th><th>p50</th><th>p95</th><th>cost</th></tr></thead>
        <tbody>
          ${runs
            .map(
              (r) => `
            <tr>
              <td><a class="run-link" href="#/run/${r.id}">${fmt.esc(r.label)}</a></td>
              <td class="dim">${fmt.date(r.startedAt)}</td>
              <td>${badge(r.status)}</td>
              <td><span class="pct ${r.summary.passRate >= 0.9 ? 'ok' : 'bad'}">${fmt.pct(r.summary.passRate)}</span></td>
              <td>${fmt.ms(r.summary.p50LatencyMs)}</td>
              <td>${fmt.ms(r.summary.p95LatencyMs)}</td>
              <td>${fmt.usd(r.summary.totalCostUsd)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

async function renderRun(id) {
  const { run, results } = await api(`/api/runs/${id}`);
  suiteEl.textContent = run.label;
  app.innerHTML = `
    <div class="panel summary-line">
      <div><strong>${fmt.esc(run.label)}</strong> ${badge(run.status)} <span class="mono dim">${run.id}</span></div>
      <div class="dim">
        ${fmt.date(run.startedAt)} · ${run.summary.total} cases · ${fmt.pct(run.summary.passRate)} pass ·
        p50 ${fmt.ms(run.summary.p50LatencyMs)} · p95 ${fmt.ms(run.summary.p95LatencyMs)} ·
        cost ${fmt.usd(run.summary.totalCostUsd)} · ${(run.summary.durationMs / 1000).toFixed(1)}s
      </div>
      <div><a href="#/compare">compare with another run →</a></div>
    </div>
    <div class="panel">
      <table>
        <thead><tr><th>status</th><th>case</th><th>latency</th><th>cost</th><th>scorers</th></tr></thead>
        <tbody>
          ${results
            .map((row) => {
              const scorers = JSON.parse(row.scorers);
              const detail = JSON.parse(row.detail);
              return `
              <tr class="case-row" data-id="${row.id}">
                <td>${badge(row.status)}</td>
                <td><strong>${fmt.esc(row.caseId)}</strong><div class="dim">${fmt.esc(row.title)}</div></td>
                <td>${fmt.ms(row.latencyMs)}</td>
                <td>${fmt.usd(row.costUsd)}</td>
                <td>${scorers.map((s) => `<span class="chip">${s.name}</span>`).join('')}</td>
              </tr>
              <tr class="case-detail" id="detail-${row.id}">
                <td colspan="5">
                  ${scorers.map((s) => `<div class="scorer"><span class="s-${s.status}">${s.name}: ${s.status}</span> — ${fmt.esc(fmt.trunc(s.detail))}</div>`).join('')}
                  <div class="grid">
                    <div><div class="dim">input</div><pre>${fmt.esc(fmt.json(detail.input))}</pre></div>
                    <div><div class="dim">output</div><pre>${fmt.esc(fmt.json(detail.response ? detail.response.body : undefined))}</pre></div>
                  </div>
                  ${detail.error ? `<div class="scorer"><span class="s-error">error</span> — ${fmt.esc(detail.error)}</div>` : ''}
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
  app.querySelectorAll('.case-row').forEach((row) => {
    row.addEventListener('click', () => row.classList.toggle('expanded'));
  });
}

async function compareView() {
  const { runs } = await api('/api/refs');
  if (runs.length < 2) {
    app.innerHTML =
      '<div class="empty">need at least two runs to compare — run <code>benchy run --label v1.2</code> a few times</div>';
    return;
  }
  const a = runs[1].label ?? runs[1].id;
  const b = runs[0].label ?? runs[0].id;
  location.hash = `#/compare/${a}..${b}`;
}

async function renderCompare(fromId, toId, runs = []) {
  const [{ comparison: c }, { runs: refs }] = await Promise.all([
    api(`/api/compare?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`),
    api('/api/refs'),
  ]);
  if (runs.length === 0) runs = refs;
  suiteEl.textContent = `${c.a.label} → ${c.b.label}`;

  const order = { regressed: 0, fixed: 1, 'latency-regression': 2, added: 3, removed: 4 };
  const changes = [...c.changes].sort((x, y) => order[x.kind] - order[y.kind]);
  const count = (kind) => c.changes.filter((x) => x.kind === kind).length;

  app.innerHTML = `
    <div class="panel">
      <h2>compare</h2>
      <div class="compare-bar">
        <label>base</label>
        <select id="cmp-a">${runs.map((r) => `<option value="${r.id}" ${r.id === c.a.id ? 'selected' : ''}>${fmt.esc(r.label)}</option>`).join('')}</select>
        <label>vs</label>
        <select id="cmp-b">${runs.map((r) => `<option value="${r.id}" ${r.id === c.b.id ? 'selected' : ''}>${fmt.esc(r.label)}</option>`).join('')}</select>
        <button id="cmp-go">compare</button>
      </div>
      <div class="summary-line">
        <strong>${fmt.esc(c.a.label)}</strong> → <strong>${fmt.esc(c.b.label)}</strong>
        <span class="dim">· pass ${fmt.pct(c.a.summary.passRate)} → </span>
        <b class="${c.passRateDelta >= 0 ? 'delta-down' : 'delta-up'}">${fmt.pct(c.b.summary.passRate)}</b>
        <span class="dim">· p50 ${fmt.ms(c.a.summary.p50LatencyMs)} → ${fmt.ms(c.b.summary.p50LatencyMs)}</span>
        <span class="dim">· cost ${fmt.usd(c.a.summary.totalCostUsd)} → ${fmt.usd(c.b.summary.totalCostUsd)}</span>
      </div>
    </div>

    <div class="panel">
      <h2>changes — ${count('regressed')} regression(s), ${count('fixed')} fixed, ${count('added')} added, ${count('removed')} removed, ${count('latency-regression')} slower</h2>
      ${
        changes.length === 0
          ? '<div class="empty">nothing changed between these runs</div>'
          : `
        <table class="diff-table">
          <thead><tr><th>change</th><th>case</th><th>base</th><th>head</th></tr></thead>
          <tbody>
            ${changes
              .map(
                (x) => `
              <tr>
                <td>${changeBadge(x.kind)}</td>
                <td><strong>${fmt.esc(x.caseId)}</strong><div class="dim">${fmt.esc(x.title)}</div></td>
                <td class="dim">${x.before ? `${fmt.esc(x.before.status)} · ${fmt.ms(x.before.latencyMs)}` : '—'}</td>
                <td>${x.after ? `${fmt.esc(x.after.status)} · ${fmt.ms(x.after.latencyMs)}` : '—'}</td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>`
      }
    </div>`;
  const aSel = document.getElementById('cmp-a');
  const bSel = document.getElementById('cmp-b');
  document.getElementById('cmp-go').addEventListener('click', () => {
    const a = runs.find((r) => r.id === aSel.value);
    const b = runs.find((r) => r.id === bSel.value);
    location.hash = `#/compare/${fmt.esc(a.label)}..${fmt.esc(b.label)}`;
  });
}

function changeBadge(kind) {
  const map = { regressed: 'failed', fixed: 'passed', added: 'neutral' };
  if (kind === 'latency-regression') return '<span class="badge skipped">slower</span>';
  if (kind === 'removed') return '<span class="badge neutral">removed</span>';
  return badge(map[kind]);
}

function parseHash() {
  const hash = location.hash.slice(1) || '/';
  const runMatch = hash.match(/^\/run\/([0-9a-f-]+)$/);
  const cmpMatch = hash.match(/^\/compare\/(.+)\.\.(.+)$/);
  if (runMatch) return () => renderRun(runMatch[1]);
  if (cmpMatch) return () => renderCompare(cmpMatch[1], cmpMatch[2]);
  if (hash === '/compare') return compareView;
  return overview;
}

window.addEventListener('hashchange', async () => {
  try {
    await parseHash()();
  } catch (err) {
    app.innerHTML = `<div class="empty">failed to load view: ${fmt.esc(err.message)}</div>`;
  }
});

parseHash()().catch((err) => {
  app.innerHTML = `<div class="empty">failed to load: ${fmt.esc(err.message)}</div>`;
});
