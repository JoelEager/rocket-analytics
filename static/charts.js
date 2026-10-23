// Rocket Analytics charts: the CHART_DEFS registry drives both the
// inline chart box and the full-page explorer modal. A classic script,
// not a module, so file:// previews and the offline build work — it
// shares app.js's top-level bindings ($, esc, STATS, wireTabs, showModal,
// closeModal) and the global Chart from chart.umd.min.js; load order is
// JS_FILES in sitegen/config.py.

Chart.defaults.color = '#9ca3af';
Chart.defaults.borderColor = '#1f2937';

const PAGE_SIZE = 10;

// A bar chart plus a paged view over a {label: count} dataset. Returns
// the chart and its paging controls as one object; the caller hides the
// pager when pageCount() is 1.
function pagedBarChart(canvas, fullNames) {
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Launches',
        data: [],
        backgroundColor: '#6ea8fe',
      }],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: {ticks: {precision: 0}},
      },
      plugins: {
        legend: {display: false},
        // Chart labels are abbreviations; tooltips show the full name.
        tooltip: fullNames ? {callbacks: {
          title: items => fullNames[items[0].label] || items[0].label,
        }} : {},
      },
    },
  });
  let full = {}, page = 0;
  const pageCount = () =>
    Math.max(1, Math.ceil(Object.keys(full).length / PAGE_SIZE));
  const setPage = p => {
    page = Math.max(0, Math.min(p, pageCount() - 1));
    const entries = Object.entries(full)
      .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    chart.data.labels = entries.map(([k]) => k);
    chart.data.datasets[0].data = entries.map(([, v]) => v);
    chart.update();
  };
  const setData = d => { full = d; setPage(0); };
  return {chart, get page() { return page; }, pageCount, setPage, setData};
}

// Scope lookup shared by chart defs: 'all' reads the lifetime stats key,
// a year reads that year's bucket (missing years -> empty chart).
const scopedData = (allKey, yearKey) => scope =>
  scope === 'all' ? STATS[allKey] : STATS.yearly[scope]?.[yearKey] ?? {};

// Registry of every chart the UI can show. `inline` charts also get a tab
// in the main-page box; the rest appear only in the explorer modal's
// pickers. Each def lists the filters it supports ('year' renders the
// scope control), maps a scope to its dataset, and mounts a chart object
// on a canvas — the pager shows only when the result has pageCount().
const CHART_DEFS = {
  'by-rocket': {
    label: 'By rocket',
    inline: true,
    filters: ['year'],
    unit: 'launches',
    data: scopedData('by_rocket', 'rockets'),
    mount: canvas => pagedBarChart(canvas),
  },
  'by-manufacturer': {
    label: 'By manufacturer',
    inline: true,
    filters: ['year'],
    unit: 'launches',
    data: scopedData('by_manufacturer', 'manufacturers'),
    mount: canvas => pagedBarChart(canvas, STATS.manufacturer_names),
  },
  'by-country': {
    label: 'By country',
    inline: true,
    filters: ['year'],
    unit: 'launches',
    data: scopedData('by_country', 'countries'),
    mount: canvas => pagedBarChart(canvas, STATS.country_names),
  },
};

// Segmented 'All time' / per-year control; reports the chosen scope via
// onChange. Hides itself when there's no yearly data to switch between.
function makeScopeSeg(scope, onChange) {
  const el = document.createElement('div');
  el.className = 'seg';
  const btns = [];
  const activate = v =>
    btns.forEach(b => b.classList.toggle('active', b.dataset.scope === v));
  // 'all' first, then years oldest-to-newest (yearly keys arrive
  // newest-first from the stats build).
  [['all', 'All time'], ...Object.keys(STATS.yearly).reverse().map(y => [y, y])]
    .forEach(([v, label]) => {
      const b = document.createElement('button');
      b.className = 'seg-btn';
      b.dataset.scope = v;
      b.textContent = label;
      b.addEventListener('click', () => { activate(v); onChange(v); });
      btns.push(b);
      el.append(b);
    });
  activate(scope);
  el.hidden = !Object.keys(STATS.yearly).length;
  return el;
}

// Wire ‹ [n] of N › controls to a chart; returns a refresh that also
// hides the pager when the data fits on one page. getChart is a function
// so the target can change (active tab, swapped chart def).
function attachPager(els, getChart) {
  const refresh = () => {
    const c = getChart(), n = c.pageCount();
    els.wrap.hidden = n <= 1;
    els.prev.disabled = c.page <= 0;
    els.next.disabled = c.page >= n - 1;
    if (els.select.options.length !== n) {
      els.select.innerHTML = Array.from({length: n},
        (_, i) => `<option value="${i}">${i + 1}</option>`).join('');
    }
    els.select.value = c.page;
    els.total.textContent = `of ${n}`;
  };
  els.prev.addEventListener('click', () => {
    const c = getChart();
    c.setPage(c.page - 1);
    refresh();
  });
  els.next.addEventListener('click', () => {
    const c = getChart();
    c.setPage(c.page + 1);
    refresh();
  });
  els.select.addEventListener('change', () => {
    getChart().setPage(+els.select.value);
    refresh();
  });
  return refresh;
}

// Inline box: one tab and pane per `inline` def, generated here so adding
// an inline chart is only a registry entry. Scope control and pager are
// shared across tabs.
const chartPanes = $('chart-panes');
const charts = {};  // pane id -> {id, def, inst}
for (const [id, def] of Object.entries(CHART_DEFS)) {
  if (!def.inline) continue;
  const pane = document.createElement('div');
  pane.className = 'chart-pane';
  pane.id = `chart-${id}`;
  pane.hidden = true;
  pane.innerHTML = '<canvas></canvas>';
  chartPanes.append(pane);
  const inst = def.mount(pane.querySelector('canvas'));
  inst.setData(def.data('all'));
  charts[pane.id] = {id, def, inst};
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.dataset.pane = pane.id;
  tab.textContent = def.label;
  $('chart-tabs').insertBefore(tab, $('chart-pager'));
}
chartPanes.firstElementChild.hidden = false;
$('chart-tabs').firstElementChild.classList.add('active');

const activeChart = () => charts[
  document.querySelector('#chart-tabs .tab.active').dataset.pane].inst;

const refreshPager = attachPager({
  wrap: $('chart-pager'), prev: $('pager-prev'), next: $('pager-next'),
  select: $('pager-select'), total: $('pager-total')}, activeChart);

// Charts mount while their pane is hidden (0x0), so resize on tab switch.
wireTabs('#chart-tabs .tab', '#chart-panes .chart-pane',
  () => { activeChart().chart.resize(); refreshPager(); });

// The inline scope control swaps every tab's dataset at once.
let inlineScope = 'all';
$('chart-scope').append(makeScopeSeg('all', scope => {
  inlineScope = scope;
  for (const pane in charts)
    charts[pane].inst.setData(charts[pane].def.data(scope));
  refreshPager();
}));
refreshPager();

// Chart explorer modal: one or two independent slots, each with its own
// chart picker, filters, and pager. Slots are built on open and torn down
// on close; each chart needs a resize() once the modal becomes visible.
const chartModal = $('chart-modal');
const slotsEl = $('chart-slots');
const splitBtn = $('split-btn');
let slots = [];

function slotPager(slot) {
  const wrap = slot.el.querySelector('.pager');
  const [prev, next] = wrap.querySelectorAll('.seg-btn');
  return attachPager({
    wrap, prev, next,
    select: wrap.querySelector('.pager-select'),
    total: wrap.querySelector('.pager-total')}, () => slot.inst);
}

// (Re)build a slot for its current def: fresh chart instance plus that
// def's filter controls.
function mountSlot(slot) {
  const def = CHART_DEFS[slot.defId];
  slot.inst?.chart.destroy();
  slot.inst = def.mount(slot.canvas);
  slot.inst.setData(def.data(slot.scope));
  slot.filtersEl.replaceChildren();
  if (def.filters.includes('year')) {
    slot.filtersEl.append(makeScopeSeg(slot.scope, scope => {
      slot.scope = scope;
      slot.inst.setData(CHART_DEFS[slot.defId].data(scope));
      slot.refreshPager();
      syncAxes();
    }));
  }
  slot.refreshPager();
  syncAxes();
}

function layoutSlots() {
  slotsEl.classList.toggle('split', slots.length > 1);
  splitBtn.hidden = slots.length > 1;
  // The last remaining chart can't be removed.
  slots.forEach(s => {
    s.el.querySelector('.slot-close').hidden = slots.length === 1;
  });
}

// Force both slots onto the same y-axis when they chart the same unit, so
// bar heights compare honestly. The max comes from each slot's full
// dataset, not just the visible page.
function syncAxes() {
  const units = slots.map(s => CHART_DEFS[s.defId].unit);
  const shared = slots.length === 2 && units[0] && units[0] === units[1];
  const max = shared
    ? Math.max(0, ...slots.flatMap(s =>
        Object.values(CHART_DEFS[s.defId].data(s.scope))))
    : 0;
  slots.forEach(s => {
    s.inst.chart.options.scales.y.max = max || undefined;
    s.inst.chart.update();
  });
}

function addSlot(defId, scope) {
  if (slots.length >= 2) return;
  const el = document.createElement('div');
  el.className = 'chart-slot';
  el.innerHTML = `
    <div class="chart-slot-head">
      <select class="chart-pick" aria-label="Chart"></select>
      <div class="slot-filters"></div>
      <button class="slot-close" type="button" aria-label="Remove chart">&times;</button>
    </div>
    <div class="chart-pane"><canvas></canvas></div>
    <div class="seg pager" hidden>
      <button class="seg-btn" type="button" aria-label="Previous page">‹</button>
      <select class="pager-select" aria-label="Page"></select>
      <span class="pager-total"></span>
      <button class="seg-btn" type="button" aria-label="Next page">›</button>
    </div>`;
  const slot = {
    el,
    canvas: el.querySelector('canvas'),
    filtersEl: el.querySelector('.slot-filters'),
    defId,
    scope,
    inst: null,
  };
  const select = el.querySelector('.chart-pick');
  select.innerHTML = Object.entries(CHART_DEFS)
    .map(([id, d]) => `<option value="${id}">${esc(d.label)}</option>`)
    .join('');
  select.value = defId;
  select.addEventListener('change', () => {
    slot.defId = select.value;
    mountSlot(slot);
  });
  el.querySelector('.slot-close')
    .addEventListener('click', () => removeSlot(slot));
  slot.refreshPager = slotPager(slot);
  slotsEl.append(el);
  slots.push(slot);
  mountSlot(slot);
  layoutSlots();
}

function removeSlot(slot) {
  slot.inst?.chart.destroy();
  slot.el.remove();
  slots = slots.filter(s => s !== slot);
  layoutSlots();
  syncAxes();
}

function openChartModal() {
  const pane = document.querySelector('#chart-tabs .tab.active').dataset.pane;
  // Seed the slot with what the inline box is currently showing.
  addSlot(charts[pane].id, inlineScope);
  showModal(chartModal);
  slots.forEach(s => s.inst.chart.resize());
}

function closeChartModal() {
  slots.forEach(s => s.inst?.chart.destroy());
  slots = [];
  slotsEl.replaceChildren();
  layoutSlots();  // drop .split and restore the Split view button
  closeModal(chartModal);
}

$('all-charts-btn').addEventListener('click', openChartModal);
// Split view duplicates the current chart — the same def at a different
// scope is the common comparison.
splitBtn.addEventListener('click', () => addSlot(slots[0].defId, slots[0].scope));
chartModal.querySelector('.modal-close')
  .addEventListener('click', closeChartModal);
chartModal.addEventListener('click',
  e => { if (e.target === chartModal) closeChartModal(); });
