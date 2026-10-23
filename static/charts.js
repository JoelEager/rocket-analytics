// Chart wiring: the filter controls, the inline chart box, and the
// full-page explorer modal, all driven by CHART_DEFS in chart-defs.js.
// A classic script, not a module, so file:// previews and the offline
// build work — it shares app.js's top-level bindings ($, esc, STATS,
// wireTabs, showModal, closeModal) plus the factories/views and defs
// from the other chart files; load order is JS_FILES in
// sitegen/config.py.
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
  // 'Successes only' — donut defs can't show the failed segment, so
  // this toggle swaps their dataset to success counts instead.
  success: (slot, reload) => {
    const label = document.createElement('label');
    label.className = 'success-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = slot.filters.successOnly;
    cb.addEventListener('change', () => {
      slot.filters.successOnly = cb.checked;
      reload();
    });
    label.append(cb, ' Successes only');
    return label;
  },
  // Dropdown of the def's entities for trend charts. A stale entity
  // from a previous def in this slot resets to the first entry.
  entity: (slot, reload) => {
    const list = CHART_DEFS[slot.defId].entities();
    if (!list.some(([v]) => v === slot.filters.entity))
      slot.filters.entity = list[0]?.[0];
    const select = document.createElement('select');
    select.className = 'chart-pick';
    select.innerHTML = list.map(([v, label]) =>
      `<option value="${esc(v)}">${esc(label)}</option>`).join('');
    select.value = slot.filters.entity;
    select.addEventListener('change', () => {
      slot.filters.entity = select.value;
      reload();
    });
    return select;
  },
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
  const inst = def.mount(pane);
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
const freshFilters = year => ({year,
  country: {codes: new Set(), negate: false}, successOnly: false});
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
// def's filter controls. The pane is reset to a bare canvas first —
// defs like the donut replace the pane's contents with their own
// layout, so a leftover canvas/table would linger otherwise. Controls
// are built before data() runs so they can seed filter defaults (e.g.
// the entity picker's first entry).
function mountSlot(slot) {
  const def = CHART_DEFS[slot.defId];
  slot.inst?.chart.destroy();
  slot.pane.innerHTML = '<canvas></canvas>';
  slot.pane.classList.remove('donut-pane');
  slot.inst = def.mount(slot.pane);
  slot.filtersEl.replaceChildren(
    ...def.filters.map(f => FILTER_BUILDERS[f](slot, () => reloadSlot(slot))));
  slot.inst.setData(def.data(slot.filters));
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
    // Non-cartesian charts (the donuts) have no scales.y to sync.
    const y = s.inst.chart.options.scales?.y;
    if (y) y.suggestedMax = max || undefined;
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
    pane: el.querySelector('.chart-pane'),
    filtersEl: el.querySelector('.slot-filters'),
    defId,
    filters,
    inst: null,
  };
  const select = el.querySelector('.chart-pick');
  // Options carry the def's chart-type prefix (the inline tabs keep
  // the short label).
  select.innerHTML = Object.entries(CHART_DEFS)
    .map(([id, d]) =>
      `<option value="${id}">${d.kind} ${esc(d.label.toLowerCase())}</option>`)
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
