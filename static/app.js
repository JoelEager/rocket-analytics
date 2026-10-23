// Rocket Analytics front end: launch/rocket tables, detail modals, charts.
// All data is baked into the page by the build as JSON inside
// <script type="application/json"> tags; parse it once up front.

const $ = id => document.getElementById(id);
const readJson = id => JSON.parse($(id).textContent);

const LAUNCHES = {upcoming: readJson('data-upcoming'), past: readJson('data-previous')};
const ENTITIES = readJson('data-entities');
const STATS = readJson('data-stats');
// url -> data URI for images embedded in the offline bundle; empty online,
// where imgSrc passes the original URL straight through.
const IMAGES = readJson('data-images');
const imgSrc = url => IMAGES[url] || url;

// Formatting and markup helpers
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmtLocal = s => s ? new Date(s)
  .toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : null;
const num = (v, unit) => v != null ? Number(v).toLocaleString() + (unit ? ' ' + unit : '') : null;
const yesNo = v => v == null ? null : (v ? 'Yes' : 'No');
const extLink = (label, url) => url
  ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : '';

// ISO 8601 durations ("P3DT12H" as stored by the API) -> "3d 12h"
const fmtDuration = s => {
  const m = s && s.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/);
  if (!m) return s;
  return [[m[1], 'd'], [m[2], 'h'], [m[3], 'm']]
    .filter(([v]) => v).map(([v, u]) => v + u).join(' ') || null;
};

$('data-updated').textContent = fmtLocal($('data-updated').dataset.ts);
// The server-side date is ISO text; reformat each table cell locally.
document.querySelectorAll('td[data-net]').forEach(td => {
  const d = new Date(td.dataset.net);
  if (isNaN(d)) return;
  td.innerHTML = esc(d.toLocaleDateString(undefined, {dateStyle: 'medium'}))
    + '<br>' + esc(d.toLocaleTimeString(undefined, {timeStyle: 'short'}));
});

// Render [label, value] pairs as <dt>/<dd>, skipping empty values
const dlRows = pairs => pairs
  .filter(([, v]) => v != null && v !== '')
  .map(([l, v]) => `<dt>${esc(l)}</dt><dd>${esc(v)}</dd>`)
  .join('');

// Evaluate [label, getter] field definitions against an object
const fieldRows = (obj, defs) => dlRows(defs.map(([l, get]) => [l, get(obj)]));

// Field definitions for the details modals: [label, getter] pairs, in
// display order. Getters return null/'' for fields to skip.
const LAUNCH_FIELDS = [
  ['Date', d => fmtLocal(d.net)],
  ['Status', d => d.status],
  ['Launch window', d => d.window_start && `${fmtLocal(d.window_start)} – ${fmtLocal(d.window_end)}`],
  ['Mission', d => d.mission_name],
  ['Type', d => d.mission_type],
  ['Orbit', d => d.orbit],
  ['Program', d => (d.program || []).filter(Boolean).join(' · ')],
  ['Success probability', d => d.probability != null && d.probability >= 0 ? `${d.probability}%` : null],
  ['Hold reason', d => d.holdreason],
  ['Failure reason', d => d.failreason],
  ['Weather concerns', d => d.weather_concerns],
];

// Launch-record rows shared by provider, agency, and rocket sections
const RECORD_FIELDS = [
  ['Launches', e => e.launches],
  ['Successful', e => e.successful],
  ['Failed', e => e.failed],
  ['Pending', e => e.pending],
  ['Success streak', e => e.streak],
  ['Landings', e => e.landings_attempted != null
    ? `${e.landings_successful}/${e.landings_attempted}` : null],
  ['Failed landings', e => e.landings_failed],
  ['Landing streak', e => e.landing_streak],
];

const ROCKET_FIELDS = [
  ['Family', r => r.family],
  ['Variant', r => r.variant],
  ['Status', r => r.active == null ? null : (r.active ? 'Active' : 'Retired')],
  ['Reusable', r => yesNo(r.reusable)],
  ['Length', r => num(r.length, 'm')],
  ['Diameter', r => num(r.diameter, 'm')],
  ['Launch mass', r => num(r.launch_mass, 't')],
  ['LEO capacity', r => num(r.leo_capacity, 'kg')],
  ['GTO capacity', r => num(r.gto_capacity, 'kg')],
  ['Thrust', r => num(r.thrust, 'kN')],
  ['Maiden flight', r => r.maiden_flight],
  ['Launch cost', r => r.launch_cost != null ? `$${num(r.launch_cost)}` : null],
  ['Alias', r => r.alias],
  ['Stages', r => r.min_stage != null ? `${r.min_stage}–${r.max_stage}` : null],
  ['Apogee', r => num(r.apogee, 'km')],
  ['Range', r => num(r.vehicle_range, 'km')],
  ...RECORD_FIELDS,
];

const AGENCY_FIELDS = [
  ['Type', a => a.type],
  ['Country', a => a.country],
  ['Administrator', a => a.administrator],
  ['Founded', a => a.founded],
  ['Launchers', a => a.launchers],
  ['Spacecraft', a => a.spacecraft],
  ...RECORD_FIELDS,
];

const PAD_FIELDS = [
  ['Location', p => p.location],
  ['Coordinates', p => p.latitude && `${p.latitude}, ${p.longitude}`],
  ['Launches', p => p.launches],
];

// Extra launch stats comparing against the pad's own history
const statRows = d => {
  const total = d.attempts_location;
  const location = ENTITIES.pads[d.pad_id]?.location;
  const year = d.attempts_location_year;
  return [
    ...(location && total != null
      ? [[`Launches from ${location}`, `${total}${year != null ? ` (${year} this year)` : ''}`]]
      : []),
    ['Since last pad launch', fmtDuration(d.pad_turnaround)],
  ];
};

// Entity (rocket/provider/agency/pad) sections inside the modals
const entityLinks = e => [['Info', e && e.info_url], ['Wiki', e && e.wiki_url]];

function entityBody(e, fieldDefs, links) {
  if (!e || !e.name) return '';
  const linkHtml = links.filter(([, u]) => u)
    .map(([l, u]) => extLink(l, u)).join(' ');
  return (e.image ? `<img class="modal-image" src="${esc(imgSrc(e.image))}" alt="">` : '')
    + `<dl class="modal-details">${fieldRows(e, fieldDefs)}</dl>`
    + (e.description ? `<p class="entity-desc">${esc(e.description)}</p>` : '')
    + (linkHtml ? `<p class="entity-links">${linkHtml}</p>` : '');
}

function entitySection(title, e, fieldDefs, links) {
  const body = entityBody(e, fieldDefs, links);
  return body ? `<h3>${esc(title)}: ${esc(e.name)}</h3>${body}` : '';
}

// The provider logo is often the same asset as the rocket image — show it once.
const dedupeProviderImage = (provider, rocket) =>
  provider && rocket && provider.image === rocket.image
    ? {...provider, image: null} : provider;

function renderEntities(d) {
  const rocket = ENTITIES.rockets[d.rocket_id];
  const provider = dedupeProviderImage(ENTITIES.providers[d.provider_id], rocket);
  const pad = ENTITIES.pads[d.pad_id];
  const agencies = (d.agency_ids || [])
    .map(id => ENTITIES.agencies[id]).filter(Boolean);

  let html = entitySection('Rocket', rocket, ROCKET_FIELDS, entityLinks(rocket))
    + entitySection('Provider', provider, AGENCY_FIELDS, entityLinks(provider))
    + entitySection('Pad', pad, PAD_FIELDS,
      [['Map', pad && pad.map_url], ...entityLinks(pad)]);

  if (agencies.length) {
    html += '<h3>Agencies</h3><ul class="entity-list">'
      + agencies.map(a =>
        `<li>${esc(a.name)}${a.abbrev ? ` (${esc(a.abbrev)})` : ''}</li>`).join('')
      + '</ul>';
  }
  $('mtab-entities').innerHTML = html || '<p class="muted">No details available.</p>';
}

const updateCard = u => `<div class="update">
  <div class="update-meta">${u.profile_image ? `<img class="update-avatar" src="${esc(u.profile_image)}" alt="">` : ''}${esc(fmtLocal(u.created_on) || '')}${u.created_by ? ' · ' + esc(u.created_by) : ''}</div>
  <p>${esc(u.comment)}</p>
  ${u.info_url ? extLink('Source', u.info_url) : ''}
</div>`;

function renderUpdates(d) {
  const updates = d.updates || [];
  $('mtab-updates').innerHTML = updates.length
    ? updates.map(updateCard).join('')
    : '<p class="muted">No updates for this launch.</p>';
}

const linkList = links => '<ul class="link-list">' + links.map(l =>
  `<li>${extLink(l.label || l.url, l.url)}</li>`
).join('') + '</ul>';

function renderLinks(d) {
  const launch = d.links || [];
  const mission = d.mission_links || [];
  $('mtab-links').innerHTML =
    (launch.length ? `<h3>Launch</h3>${linkList(launch)}` : '')
    + (mission.length ? `<h3>Mission</h3>${linkList(mission)}` : '')
    || '<p class="muted">No links for this launch.</p>';
}

// Generic tab wiring: buttons carry data-pane pointing at their pane's id.
// Returns a reset function that re-activates the first tab.
function wireTabs(btnSel, paneSel, onSwitch) {
  const btns = [...document.querySelectorAll(btnSel)];
  const panes = [...document.querySelectorAll(paneSel)];
  const activate = btn => {
    btns.forEach(b => b.classList.toggle('active', b === btn));
    panes.forEach(p => p.hidden = p.id !== btn.dataset.pane);
    if (onSwitch) onSwitch(btn);
  };
  btns.forEach(btn => btn.addEventListener('click', () => activate(btn)));
  return () => activate(btns[0]);
}

const filterInput = $('filter');
const filterCount = $('filter-count');

// One filter across all launch/rocket tables; the count reflects the
// currently visible pane.
function applyFilter() {
  const q = filterInput.value.trim().toLowerCase();
  document.querySelectorAll('.table-wrap tbody tr').forEach(tr => {
    tr.hidden = q !== '' && !tr.textContent.toLowerCase().includes(q);
  });
  filterCount.textContent = q
    ? `${document.querySelector('.table-wrap:not([hidden])')
        .querySelectorAll('tbody tr:not([hidden])').length} matches`
    : '';
}
filterInput.addEventListener('input', applyFilter);
wireTabs('#launch-tabs .tab', '.table-wrap', applyFilter);

// Sortable rocket columns: data-sort names a rocket entity key.
// A new column starts descending; re-clicking flips direction.
const rocketTbody = document.querySelector('#tab-rockets tbody');
const rocketSortThs = document.querySelectorAll('#tab-rockets th.sortable');
let rocketSortKey = 'launches';
rocketSortThs.forEach(th => th.addEventListener('click', () => {
  const key = th.dataset.sort;
  const dir = key === rocketSortKey && th.dataset.dir === 'desc'
    ? 'asc' : 'desc';
  rocketSortKey = key;
  rocketSortThs.forEach(t => delete t.dataset.dir);
  th.dataset.dir = dir;
  const mul = dir === 'desc' ? 1 : -1;
  const val = tr => ENTITIES.rockets[tr.dataset.id]?.[key];
  [...rocketTbody.querySelectorAll('tr')]
    .sort((a, b) => {
      const va = val(a), vb = val(b);
      // Unknowns stay at the bottom in either direction.
      if (va == null) return vb == null ? 0 : 1;
      if (vb == null) return -1;
      return mul * (vb - va);
    })
    .forEach(r => rocketTbody.appendChild(r));
}));

const modal = $('modal');
const rocketModal = $('rocket-modal');
const setImg = (img, url) => { img.hidden = !url; if (url) img.src = url; };
const resetModalTabs = wireTabs('#modal .modal-tabs .tab', '#modal .modal-pane');
const resetRocketTabs = wireTabs('#rocket-modal .modal-tabs .tab',
                                 '#rocket-modal .modal-pane');

function showModal(m) {
  m.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal(m) {
  m.hidden = true;
  document.body.style.overflow = '';
}

function openModal(d) {
  $('modal-name').textContent = d.name;
  setImg($('modal-image'), d.image);
  setImg($('modal-infographic'), d.infographic);
  $('modal-live').hidden = !d.webcast_live;
  $('modal-details').innerHTML = fieldRows(d, LAUNCH_FIELDS);
  $('modal-desc').textContent = d.mission_description || '';
  $('modal-patches').innerHTML = (d.mission_patches || [])
    .map(u => `<img class="patch" src="${esc(imgSrc(u))}" alt="Mission patch">`).join('');

  const statsHtml = dlRows(statRows(d));
  $('modal-stats').innerHTML = statsHtml;
  $('modal-stat-head').hidden = !statsHtml;

  renderEntities(d);
  renderUpdates(d);
  renderLinks(d);
  resetModalTabs();
  showModal(modal);
}

function openRocketModal(id) {
  const rocket = ENTITIES.rockets[id];
  if (!rocket) return;
  $('rocket-modal-name').textContent = rocket.name || 'Rocket';
  $('rtab-rocket').innerHTML =
    entityBody(rocket, ROCKET_FIELDS, entityLinks(rocket))
    || '<p class="muted">No details available.</p>';

  // The manufacturer may be stored as a provider or an agency entity.
  const provider = dedupeProviderImage(
    ENTITIES.providers[rocket.manufacturer_id]
      || ENTITIES.agencies[rocket.manufacturer_id], rocket);
  $('rtab-provider').innerHTML = provider
    ? entityBody(provider, AGENCY_FIELDS, entityLinks(provider))
    : (rocket.manufacturer
        ? `<p class="entity-desc">${esc(rocket.manufacturer)}</p>`
        : '<p class="muted">No details available.</p>');

  resetRocketTabs();
  showModal(rocketModal);
}

// Row clicks open the matching modal; Esc, backdrop, and × close them.
document.querySelector('main').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-set]');
  if (!tr) return;
  if (tr.dataset.set === 'rockets') openRocketModal(tr.dataset.id);
  else openModal(LAUNCHES[tr.dataset.set][+tr.dataset.idx]);
});
[modal, rocketModal].forEach(m => {
  m.querySelector('.modal-close')
    .addEventListener('click', () => closeModal(m));
  m.addEventListener('click', e => { if (e.target === m) closeModal(m); });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  [modal, rocketModal].forEach(closeModal);
  closeChartModal();
});

// Charts: defs drive both the inline box and the explorer modal.
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
