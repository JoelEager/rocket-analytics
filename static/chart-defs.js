// Chart registry: CHART_DEFS declares every chart the UI can show (the
// comment above it spells out the def contract), plus the data-slicing
// helpers the defs' data() functions share. A classic script — uses
// STATS from app.js and the factories/views from chart-factories.js;
// load order is JS_FILES in sitegen/config.py.
// Scope lookup shared by chart defs: 'all' reads the lifetime stats key,
// a year reads that year's bucket (missing years -> empty chart).
const scopedData = (allKey, yearKey) => year =>
  year === 'all' ? STATS[allKey] : STATS.yearly[year]?.[yearKey] ?? {};

// Rocket name and manufacturer abbrev -> country code, from the stats
// build. Which map applies depends on what the chart's labels are.
const ROCKET_COUNTRIES = STATS.rocket_countries || {};
const MFR_COUNTRIES = STATS.manufacturer_countries || {};

// Restrict a {name: counts} dataset to labels whose country is (or, when
// negated, is not) among the selected codes. An empty selection filters
// nothing. map resolves each label to a code — rockets by name,
// manufacturers by abbrev.
const applyCountryFilter = (data, sel, map = ROCKET_COUNTRIES) => {
  if (!sel || !sel.codes.size) return data;
  return Object.fromEntries(Object.entries(data)
    .filter(([name]) => sel.codes.has(map[name]) !== sel.negate));
};

// Donut defs share the bar charts' categorized rows but need flat
// {label: count} slices: total each row, dropping 'failed' when the
// Successes-only filter is on.
const donutSlices = (rows, successOnly) => Object.fromEntries(
  Object.entries(rows).map(([k, row]) =>
    [k, successOnly ? rowTotal(row) - (row.failed || 0) : rowTotal(row)]));

// Trend defs need a {year: count} series for one entity (a rocket name,
// manufacturer abbrev, or country code): re-slice that group's yearly
// bucket chronologically — yearly keys arrive newest-first.
const trendData = groupKey => s => Object.fromEntries(
  Object.keys(STATS.yearly).sort().map(year => {
    const row = STATS.yearly[year][groupKey][s.entity];
    const total = rowTotal(row) || 0;
    return [year, s.successOnly ? total - (row?.failed || 0) : total];
  }));

// Entity pickers sort alphabetically by display label — a 100+ entry
// list ordered by launch count can't be scanned for a name.
const entityOptions = pairs =>
  pairs.sort((a, b) => a[1].localeCompare(b[1]));

// Registry of every chart the UI can show. `inline` charts also get a tab
// in the main-page box; the rest appear only in the explorer modal's
// pickers. `kind` prefixes the picker's option text ('Bars by rocket').
// Each def lists the filters it supports (each name renders a
// control in the modal slot — the inline box only ever shows 'year'),
// maps a filter-state object {year, country, successOnly, entity} to
// its dataset, and mounts a chart object inside a .chart-pane — the
// pager shows only when the instance's pageCount() exceeds 1. Trend
// defs also provide `entities` to populate the 'entity' filter's
// dropdown as [value, label] pairs, and `defaultEntity` — the
// most-launched entity by stats order — since alphabetically first
// would be an obscure pick.
const CHART_DEFS = {
  'by-rocket': {
    label: 'By rocket',
    kind: 'Bars',
    inline: true,
    filters: ['year', 'country'],
    unit: 'launches',
    data: s => applyCountryFilter(
      scopedData('by_rocket', 'rockets')(s.year), s.country),
    mount: pane => stackedBarChart(pane.querySelector('canvas')),
  },
  'by-manufacturer': {
    label: 'By manufacturer',
    kind: 'Bars',
    inline: true,
    filters: ['year', 'country'],
    unit: 'launches',
    data: s => applyCountryFilter(
      scopedData('by_manufacturer', 'manufacturers')(s.year), s.country,
      MFR_COUNTRIES),
    mount: pane => stackedBarChart(pane.querySelector('canvas'), STATS.manufacturer_names),
  },
  'by-country': {
    label: 'By country',
    kind: 'Bars',
    inline: true,
    filters: ['year'],
    unit: 'launches',
    data: s => scopedData('by_country', 'countries')(s.year),
    mount: pane => stackedBarChart(pane.querySelector('canvas'), STATS.country_names),
  },
  'by-rocket-donut': {
    label: 'By rocket',
    kind: 'Donut',
    filters: ['year', 'country', 'success'],
    data: s => applyCountryFilter(donutSlices(
      scopedData('by_rocket', 'rockets')(s.year), s.successOnly), s.country),
    mount: pane => donutChart(pane, null, 'Rocket'),
  },
  'by-manufacturer-donut': {
    label: 'By manufacturer',
    kind: 'Donut',
    filters: ['year', 'country', 'success'],
    data: s => applyCountryFilter(donutSlices(
      scopedData('by_manufacturer', 'manufacturers')(s.year), s.successOnly),
      s.country, MFR_COUNTRIES),
    mount: pane => donutChart(pane, STATS.manufacturer_names, 'Manufacturer'),
  },
  'by-country-donut': {
    label: 'By country',
    kind: 'Donut',
    filters: ['year', 'success'],
    data: s => donutSlices(
      scopedData('by_country', 'countries')(s.year), s.successOnly),
    mount: pane => donutChart(pane, STATS.country_names, 'Country'),
  },
  'by-rocket-trend': {
    label: 'By rocket',
    kind: 'Trend',
    filters: ['entity', 'success'],
    unit: 'launches',
    entities: () =>
      entityOptions(Object.keys(STATS.by_rocket).map(k => [k, k])),
    defaultEntity: Object.keys(STATS.by_rocket)[0],
    data: trendData('rockets'),
    mount: pane => lineChart(pane.querySelector('canvas')),
  },
  'by-manufacturer-trend': {
    label: 'By manufacturer',
    kind: 'Trend',
    filters: ['entity', 'success'],
    unit: 'launches',
    entities: () => entityOptions(Object.keys(STATS.by_manufacturer)
      .map(k => [k, STATS.manufacturer_names[k] || k])),
    defaultEntity: Object.keys(STATS.by_manufacturer)[0],
    data: trendData('manufacturers'),
    mount: pane => lineChart(pane.querySelector('canvas')),
  },
  'by-country-trend': {
    label: 'By country',
    kind: 'Trend',
    filters: ['entity', 'success'],
    unit: 'launches',
    entities: () => entityOptions(Object.keys(STATS.by_country)
      .map(k => [k, STATS.country_names[k] || k])),
    defaultEntity: Object.keys(STATS.by_country)[0],
    data: trendData('countries'),
    mount: pane => lineChart(pane.querySelector('canvas')),
  },
};
