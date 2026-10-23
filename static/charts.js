// Rocket Analytics charts: the CHART_DEFS registry drives both the
// inline chart box and the full-page explorer modal. A classic script,
// not a module, so file:// previews and the offline build work — it
// shares app.js's top-level bindings ($, esc, STATS, wireTabs, showModal,
// closeModal) and the global Chart from chart.umd.min.js; load order is
// JS_FILES in sitegen/config.py.

Chart.defaults.color = '#9ca3af';
Chart.defaults.borderColor = '#1f2937';

const PAGE_SIZE = 10;

// Paging wrapper shared by the chart factories: slices a {label: row}
// dataset PAGE_SIZE rows at a time and lets `fill` load the visible rows
// into the chart's datasets. The caller hides the pager when
// pageCount() is 1.
function pagedView(chart, fill) {
  let full = {}, page = 0;
  const pageCount = () =>
    Math.max(1, Math.ceil(Object.keys(full).length / PAGE_SIZE));
  const setPage = p => {
    page = Math.max(0, Math.min(p, pageCount() - 1));
    const entries = Object.entries(full)
      .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    chart.data.labels = entries.map(([k]) => k);
    fill(entries);
    chart.update();
  };
  const setData = d => { full = d; setPage(0); };
  return {chart, get page() { return page; }, pageCount, setPage, setData};
}

// Chart labels are abbreviations; tooltips show the full name.
const tooltipNames = fullNames => fullNames ? {callbacks: {
  title: items => fullNames[items[0].label] || items[0].label,
}} : {};

// A flat bar chart over {label: count} rows.
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
        tooltip: tooltipNames(fullNames),
      },
    },
  });
  return pagedView(chart, entries => {
    chart.data.datasets[0].data = entries.map(([, v]) => v);
  });
}

// Segment keys a stacked row may carry, in stack order (failures always
// on top). Yearly data uses orbital/suborbital/failed; 'all time' has no
// lifetime orbit breakdown, so it stacks success/failed instead.
const SEGMENTS = {
  success:    {label: 'Success',    color: '#4ade80'},
  orbital:    {label: 'Orbital',    color: '#6ea8fe'},
  suborbital: {label: 'Suborbital', color: '#a78bfa'},
  failed:     {label: 'Failed',     color: '#f87171'},
};
const SEGMENT_ORDER = ['success', 'orbital', 'suborbital', 'failed'];

// Draws each bar's segment counts above its top segment (Chart.js has
// no built-in data labels), comma-separated and colored to match the
// legend. Bars too narrow for the text are skipped so dense pages stay
// legible; layout.padding.top leaves room for the label.
const stackTotals = {
  id: 'stackTotals',
  afterDatasetsDraw(chart) {
    const n = chart.data.datasets.length;
    const meta = n && chart.getDatasetMeta(n - 1);
    if (!meta?.data?.length) return;
    const {ctx} = chart;
    ctx.save();
    ctx.font = `11px ${Chart.defaults.font.family}`;
    ctx.textAlign = 'left';
    const sepW = ctx.measureText(', ').width;
    meta.data.forEach((bar, i) => {
      const parts = chart.data.datasets.map(ds =>
        ({v: ds.data[i] || 0, color: ds.backgroundColor}));
      const widths = parts.map(p => ctx.measureText(String(p.v)).width);
      const totalW = widths.reduce((a, b) => a + b, sepW * (parts.length - 1));
      if (bar.width + 8 < totalW) return;
      const y = Math.min(bar.y, bar.base) - 4;
      let x = bar.x - totalW / 2;
      parts.forEach((p, j) => {
        ctx.fillStyle = p.color;
        ctx.fillText(p.v, x, y);
        x += widths[j] + sepW;
      });
    });
    ctx.restore();
  },
};

function stackedBarChart(canvas, fullNames) {
  const names = tooltipNames(fullNames);
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {labels: [], datasets: []},
    options: {
      maintainAspectRatio: false,
      layout: {padding: {top: 18}},
      // index mode + intersect:false makes the whole bar column a hover
      // target, so even a 1-count failure segment shows its tooltip.
      interaction: {mode: 'index', intersect: false},
      scales: {
        x: {stacked: true},
        y: {stacked: true, ticks: {precision: 0}},
      },
      plugins: {
        legend: {position: 'bottom'},
        tooltip: {
          ...names,
          callbacks: {
            ...names.callbacks,
            footer: items => 'Total: ' + items.reduce((s, i) => s + i.parsed.y, 0),
          },
        },
      },
    },
    plugins: [stackTotals],
  });
  let keys = [];
  const view = pagedView(chart, entries => {
    chart.data.datasets.forEach((ds, i) => {
      ds.data = entries.map(([, v]) => v[keys[i]] || 0);
    });
  });
  const setData = view.setData;
  // Rebuild the dataset list from whichever segment keys this dataset
  // contains, so the legend only names what the rows actually show.
  view.setData = d => {
    const present = new Set(Object.values(d).flatMap(Object.keys));
    keys = SEGMENT_ORDER.filter(k => present.has(k));
    chart.data.datasets = keys.map(k => ({
      label: SEGMENTS[k].label,
      data: [],
      backgroundColor: SEGMENTS[k].color,
    }));
    setData(d);
  };
  return view;
}

// Scope lookup shared by chart defs: 'all' reads the lifetime stats key,
// a year reads that year's bucket (missing years -> empty chart).
const scopedData = (allKey, yearKey) => year =>
  year === 'all' ? STATS[allKey] : STATS.yearly[year]?.[yearKey] ?? {};

// Rocket name -> manufacturer country code, from the stats build.
const ROCKET_COUNTRIES = STATS.rocket_countries || {};

// Restrict a {name: counts} dataset to rockets whose manufacturer country
// is (or, when negated, is not) among the selected codes. An empty
// selection filters nothing.
const applyCountryFilter = (data, sel) => {
  if (!sel || !sel.codes.size) return data;
  return Object.fromEntries(Object.entries(data)
    .filter(([name]) => sel.codes.has(ROCKET_COUNTRIES[name]) !== sel.negate));
};

// Registry of every chart the UI can show. `inline` charts also get a tab
// in the main-page box; the rest appear only in the explorer modal's
// pickers. Each def lists the filters it supports (each name renders a
// control in the modal slot — the inline box only ever shows 'year'),
// maps a filter-state object {year, country} to its dataset, and mounts
// a chart object on a canvas — the pager shows only when the result has
// pageCount().
const CHART_DEFS = {
  'by-rocket': {
    label: 'By rocket',
    inline: true,
    filters: ['year', 'country'],
    unit: 'launches',
    data: s => applyCountryFilter(
      scopedData('by_rocket', 'rockets')(s.year), s.country),
    mount: canvas => stackedBarChart(canvas),
  },
  'by-manufacturer': {
    label: 'By manufacturer',
    inline: true,
    filters: ['year'],
    unit: 'launches',
    data: s => scopedData('by_manufacturer', 'manufacturers')(s.year),
    mount: canvas => stackedBarChart(canvas, STATS.manufacturer_names),
  },
  'by-country': {
    label: 'By country',
    inline: true,
    filters: ['year'],
    unit: 'launches',
    data: s => scopedData('by_country', 'countries')(s.year),
    mount: canvas => stackedBarChart(canvas, STATS.country_names),
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

// Multi-select country picker with an Exclude toggle: a button opens a
// checkbox list so a dozen-plus options don't crowd the slot header.
// The button summarizes the live selection ("Country: not USA, CHN" /
// "Country: all but 5") and carries an accent while a filter is
// applied. Mutates sel ({codes, negate}) in place, then fires onChange.
function makeCountryFilter(sel, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'country-filter';
  const btn = document.createElement('button');
  btn.className = 'chart-pick';
  btn.type = 'button';
  const pop = document.createElement('div');
  pop.className = 'country-pop';
  pop.hidden = true;
  const label = () => {
    const picked = [...sel.codes].sort();
    const n = picked.length;
    btn.textContent = !n ? 'Country: all'
      : n <= 3 ? `Country: ${sel.negate ? 'not ' : ''}${picked.join(', ')}`
      : `Country: ${sel.negate ? 'all but ' : ''}${n}`;
    btn.title = btn.textContent;
    wrap.classList.toggle('has-sel', n > 0);
  };
  const emit = () => { label(); onChange(); };
  const head = document.createElement('div');
  head.className = 'country-pop-head';
  const clear = document.createElement('button');
  clear.className = 'country-clear';
  clear.type = 'button';
  clear.textContent = 'Clear';
  head.append('Countries', clear);
  pop.append(head);
  const negRow = document.createElement('label');
  negRow.className = 'country-row country-negate';
  const negCb = document.createElement('input');
  negCb.type = 'checkbox';
  negCb.checked = sel.negate;
  negCb.addEventListener('change', () => {
    sel.negate = negCb.checked;
    emit();
  });
  negRow.append(negCb, ' Exclude selected');
  pop.append(negRow);
  // Only countries that actually appear among rockets are worth
  // listing; names come from the stats build's country_names map.
  const codes = [...new Set(Object.values(ROCKET_COUNTRIES))]
    .sort((a, b) => (STATS.country_names[a] || a)
      .localeCompare(STATS.country_names[b] || b));
  const countryCbs = [];
  for (const code of codes) {
    const row = document.createElement('label');
    row.className = 'country-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = sel.codes.has(code);
    cb.addEventListener('change', () => {
      cb.checked ? sel.codes.add(code) : sel.codes.delete(code);
      emit();
    });
    row.append(cb, STATS.country_names[code] || code);
    pop.append(row);
    countryCbs.push(cb);
  }
  // Clear resets the whole filter — selections and exclude mode. It
  // drives the checkboxes by reference: querying .country-row inputs
  // would also hit the negate box and leave it desynced from sel.negate.
  clear.addEventListener('click', () => {
    if (!sel.codes.size && !sel.negate) return;
    sel.codes.clear();
    sel.negate = false;
    negCb.checked = false;
    countryCbs.forEach(cb => { cb.checked = false; });
    emit();
  });
  btn.addEventListener('click', () => { pop.hidden = !pop.hidden; });
  label();
  wrap.append(btn, pop);
  return wrap;
}

// A click anywhere outside an open country picker closes it.
document.addEventListener('click', e => {
  document.querySelectorAll('.country-pop:not([hidden])').forEach(p => {
    if (!p.parentElement.contains(e.target)) p.hidden = true;
  });
});

// Filter builders keyed by the names in each def's `filters` list; each
// returns a control that updates the slot's filter state on change.
const FILTER_BUILDERS = {
  year: (slot, reload) => makeScopeSeg(slot.filters.year, year => {
    slot.filters.year = year;
    reload();
  }),
  country: (slot, reload) => makeCountryFilter(slot.filters.country, reload),
};

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
  inst.setData(def.data({year: 'all'}));
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
$('chart-scope').append(makeScopeSeg('all', year => {
  inlineScope = year;
  for (const pane in charts)
    charts[pane].inst.setData(charts[pane].def.data({year}));
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

// A slot's filter state: year scope plus the country picker's
// {codes, negate} selection. cloneFilters copies it so a split slot's
// toggles don't write into its sibling's state.
const freshFilters = year => ({year, country: {codes: new Set(), negate: false}});
const cloneFilters = f => ({...f,
  country: {codes: new Set(f.country.codes), negate: f.country.negate}});

function slotPager(slot) {
  const wrap = slot.el.querySelector('.pager');
  const [prev, next] = wrap.querySelectorAll('.seg-btn');
  return attachPager({
    wrap, prev, next,
    select: wrap.querySelector('.pager-select'),
    total: wrap.querySelector('.pager-total')}, () => slot.inst);
}

// Re-read the slot's dataset from its current def + filters.
function reloadSlot(slot) {
  const def = CHART_DEFS[slot.defId];
  slot.inst.setData(def.data(slot.filters));
  slot.refreshPager();
  syncAxes();
}

// (Re)build a slot for its current def: fresh chart instance plus that
// def's filter controls.
function mountSlot(slot) {
  const def = CHART_DEFS[slot.defId];
  slot.inst?.chart.destroy();
  slot.inst = def.mount(slot.canvas);
  slot.inst.setData(def.data(slot.filters));
  slot.filtersEl.replaceChildren(
    ...def.filters.map(f => FILTER_BUILDERS[f](slot, () => reloadSlot(slot))));
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

// A dataset row is either a plain count or a {category: count} dict.
const rowTotal = v => (v && typeof v === 'object')
  ? Object.values(v).reduce((a, b) => a + b, 0) : v;

// Force both slots onto the same y-axis when they chart the same unit, so
// bar heights compare honestly. The bound comes from each slot's full
// dataset, not just the visible page. It's a suggestedMax, not max:
// Chart.js still rounds the axis top up to a nice number (a hard max of
// e.g. 637 produced ugly ticks) while never dropping below it.
function syncAxes() {
  const units = slots.map(s => CHART_DEFS[s.defId].unit);
  const shared = slots.length === 2 && units[0] && units[0] === units[1];
  const max = shared
    ? Math.max(0, ...slots.flatMap(s =>
        Object.values(CHART_DEFS[s.defId].data(s.filters)).map(rowTotal)))
    : 0;
  slots.forEach(s => {
    s.inst.chart.options.scales.y.suggestedMax = max || undefined;
    s.inst.chart.update();
  });
}

function addSlot(defId, filters) {
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
    filters,
    inst: null,
  };
  const select = el.querySelector('.chart-pick');
  // Options carry the "Launch bars" type prefix (the inline tabs keep
  // the short label); a non-bar def would get its own prefix instead.
  select.innerHTML = Object.entries(CHART_DEFS)
    .map(([id, d]) =>
      `<option value="${id}">Launch bars ${esc(d.label.toLowerCase())}</option>`)
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
  addSlot(charts[pane].id, freshFilters(inlineScope));
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
splitBtn.addEventListener('click', () => addSlot(slots[0].defId, cloneFilters(slots[0].filters)));
chartModal.querySelector('.modal-close')
  .addEventListener('click', closeChartModal);
chartModal.addEventListener('click',
  e => { if (e.target === chartModal) closeChartModal(); });
