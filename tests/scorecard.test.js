/**
 * scorecard.test.js
 *
 * Unit & integration tests for the Scorecard module helpers.
 * Run with: node tests/scorecard.test.js
 *
 * No external test framework required — uses a tiny inline assert helper.
 */

'use strict';

// ─── Inline test harness ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  ❌ FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    console.error(`       received: ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual, expected, tolerance, label) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`       expected: ~${expected} (±${tolerance})`);
    console.error(`       received: ${actual}`);
  }
}

function describe(name, fn) {
  console.log(`\n🔷 ${name}`);
  fn();
}

// ─── Stub for err() used internally by scParseApiResponse ─────────────────────
function err() {}

// ─── Inline copies of pure helpers (mirrors cortex-tools.user.js) ─────────────

function scConvertToDecimal(value) {
  if (value === undefined || value === null) return NaN;
  const s = String(value).trim();
  if (s === '-' || s === '') return NaN;
  const number = parseFloat(s.replace(',', '.'));
  return isNaN(number) ? NaN : number;
}

function scParseRow(jsonStr) {
  const raw = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.trim()] = v;
  }

  const dcrRatio = out.dcr_metric !== undefined ? Number(out.dcr_metric) : NaN;
  const podRatio = out.pod_metric !== undefined ? Number(out.pod_metric) : NaN;
  const ccRatio  = out.cc_metric  !== undefined ? Number(out.cc_metric)  : NaN;

  return {
    transporterId: out.country_program_providerid_stationcode || out.dsp_code || '',
    delivered:     String(out.delivered || '0'),
    dcr:           isNaN(dcrRatio) ? '-' : (dcrRatio * 100).toFixed(2),
    dnrDpmo:       String(out.dnr_dpmo ?? '0'),
    lorDpmo:       String(out.lor_dpmo ?? '0'),
    pod:           isNaN(podRatio) ? '-' : (podRatio * 100).toFixed(2),
    cc:            isNaN(ccRatio) ? '-' : (ccRatio * 100).toFixed(2),
    ce:            String(out.ce_metric ?? '0'),
    cdfDpmo:       String(out.cdf_dpmo ?? '0'),
    week:          out.week || '',
    year:          out.year || '',
    stationCode:   out.station_code || '',
    dspCode:       out.dsp_code || '',
    dataDate:      out.data_date || '',
    country:       out.country || '',
    program:       out.program || '',
    region:        out.region || '',
    daName:        out.da_name || '',
    lastUpdated:   out.last_updated_time || '',
    _raw: out,
  };
}

function scCalculateScore(row) {
  const dcr = (scConvertToDecimal(row.dcr === '-' ? '100' : row.dcr) || 0) / 100;
  const dnrDpmo = parseFloat(row.dnrDpmo) || 0;
  const lorDpmo = parseFloat(row.lorDpmo) || 0;
  const pod = (scConvertToDecimal(row.pod === '-' ? '100' : row.pod) || 0) / 100;
  const cc = (scConvertToDecimal(row.cc === '-' ? '100' : row.cc) || 0) / 100;
  const ce = parseFloat(row.ce) || 0;
  const cdfDpmo = parseFloat(row.cdfDpmo) || 0;
  const delivered = parseFloat(row.delivered) || 0;

  let totalScore = Math.max(Math.min(
    (132.88 * dcr) +
    (10 * Math.max(0, 1 - (cdfDpmo / 10000))) -
    (0.0024 * dnrDpmo) -
    (8.54 * ce) +
    (10 * pod) +
    (4 * cc) +
    (0.00045 * delivered) -
    60.88,
    100), 0);

  if (dcr === 1 && pod === 1 && cc === 1 && cdfDpmo === 0 && ce === 0 && dnrDpmo === 0 && lorDpmo === 0) {
    totalScore = 100;
  } else {
    let poorCount = 0;
    if ((dcr * 100) < 97) poorCount++;
    if (dnrDpmo >= 1500) poorCount++;
    if ((pod * 100) < 94) poorCount++;
    if ((cc * 100) < 70) poorCount++;
    if (ce !== 0) poorCount++;
    if (cdfDpmo >= 8000) poorCount++;

    if (poorCount >= 2) {
      let severitySum = 0;
      if ((dcr * 100) < 97) severitySum += (97 - dcr * 100) / 5;
      if (dnrDpmo >= 1500) severitySum += (dnrDpmo - 1500) / 1000;
      if ((pod * 100) < 94) severitySum += (94 - pod * 100) / 10;
      if ((cc * 100) < 70) severitySum += (70 - cc * 100) / 50;
      if (ce !== 0) severitySum += ce * 1;
      if (cdfDpmo >= 8000) severitySum += (cdfDpmo - 8000) / 2000;

      const penalty = Math.min(3, severitySum);
      totalScore = Math.min(totalScore, 70 - penalty);
    } else if (poorCount === 1) {
      let severitySum = 0;
      if ((dcr * 100) < 97) severitySum += (97 - dcr * 100) / 5;
      if (dnrDpmo >= 1500) severitySum += (dnrDpmo - 1500) / 1000;
      if ((pod * 100) < 94) severitySum += (94 - pod * 100) / 10;
      if ((cc * 100) < 70) severitySum += (70 - cc * 100) / 50;
      if (ce !== 0) severitySum += ce * 1;
      if (cdfDpmo >= 8000) severitySum += (cdfDpmo - 8000) / 2000;

      const penalty = Math.min(3, severitySum);
      totalScore = Math.min(totalScore, 85 - penalty);
    }
  }

  const roundedScore = parseFloat(totalScore.toFixed(2));

  const status = roundedScore < 40.00 ? 'Poor' :
    roundedScore < 70.00 ? 'Fair' :
      roundedScore < 85.00 ? 'Great' :
        roundedScore < 93.00 ? 'Fantastic' : 'Fantastic Plus';

  return {
    transporterId: row.transporterId,
    daName: row.daName,
    delivered: row.delivered,
    dcr: (dcr * 100).toFixed(2),
    dnrDpmo: dnrDpmo.toFixed(2),
    lorDpmo: lorDpmo.toFixed(2),
    pod: (pod * 100).toFixed(2),
    cc: (cc * 100).toFixed(2),
    ce: ce.toFixed(2),
    cdfDpmo: cdfDpmo.toFixed(2),
    status,
    totalScore: roundedScore,
    week: row.week,
    year: row.year,
    stationCode: row.stationCode,
    dspCode: row.dspCode,
    dataDate: row.dataDate,
    lastUpdated: row.lastUpdated,
    originalData: {
      dcr: row.dcr,
      dnrDpmo: row.dnrDpmo,
      lorDpmo: row.lorDpmo,
      pod: row.pod,
      cc: row.cc,
      ce: row.ce,
      cdfDpmo: row.cdfDpmo,
    }
  };
}

function scKpiClass(value, type) {
  switch (type) {
    case 'DCR':
      return value < 97 ? 'poor' : value < 98.5 ? 'fair' : value < 99.5 ? 'great' : 'fantastic';
    case 'DNRDPMO':
    case 'LORDPMO':
      return value < 1100 ? 'fantastic' : value < 1300 ? 'great' : value < 1500 ? 'fair' : 'poor';
    case 'POD':
      return value < 94 ? 'poor' : value < 95.5 ? 'fair' : value < 97 ? 'great' : 'fantastic';
    case 'CC':
      return value < 70 ? 'poor' : value < 95 ? 'fair' : value < 98.5 ? 'great' : 'fantastic';
    case 'CE':
      return value === 0 ? 'fantastic' : 'poor';
    case 'CDFDPMO':
      return value > 5460 ? 'poor' : value > 4450 ? 'fair' : value > 3680 ? 'great' : 'fantastic';
    default:
      return '';
  }
}

function scStatusClass(status) {
  switch (status) {
    case 'Poor': return 'poor';
    case 'Fair': return 'fair';
    case 'Great': return 'great';
    case 'Fantastic':
    case 'Fantastic Plus': return 'fantastic';
    default: return '';
  }
}

function scParseApiResponse(json) {
  try {
    const rows = json?.tableData?.da_dsp_station_weekly_quality?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const parsed = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        parsed.push(scParseRow(rows[i]));
      } catch (e) {
        err('Scorecard: failed to parse row', i, e);
      }
    }
    return parsed;
  } catch (e) {
    err('scParseApiResponse error:', e);
    return [];
  }
}

function scValidateWeek(week) {
  if (!week) return 'Week is required.';
  const weekRegex = /^\d{4}-W\d{2}$/;
  if (!weekRegex.test(week)) return 'Week format must be YYYY-Www (e.g. 2026-W12).';
  return null;
}

function scCurrentWeek() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function scWeeksAgo(n) {
  const now = new Date();
  now.setDate(now.getDate() - (n * 7));
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ─── Example raw API row fixture ─────────────────────────────────────────────

const EXAMPLE_API_ROW = JSON.stringify({
  dcr_metric: 0.985,
  pod_metric: 0.975,
  cc_metric: 0.99,
  dnr_dpmo: 300,
  lor_dpmo: 200,
  cdf_dpmo: 1500,
  ce_metric: 0,
  delivered: 6000,
  week: 10,
  year: 2026,
  station_code: 'XYZ1',
  dsp_code: 'TEST',
  country: 'DE',
  program: 'AMZL',
  region: 'EU',
  data_date: '2026-03-10',
  last_updated_time: '2026-03-11T08:00:00Z',
  country_program_providerid_stationcode: 'DE_AMZL_TEST_XYZ1',
});

// ─── Tests ────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// scConvertToDecimal
// ═══════════════════════════════════════════════════════════════════════════════

describe('scConvertToDecimal — basic conversions', () => {
  assert(isNaN(scConvertToDecimal('')), 'empty string → NaN');
  assert(isNaN(scConvertToDecimal('-')), 'dash "-" → NaN');
  assertEqual(scConvertToDecimal('98.5'), 98.5, '"98.5" → 98.5');
  assertEqual(scConvertToDecimal('98,5'), 98.5, '"98,5" (comma decimal) → 98.5');
  assert(isNaN(scConvertToDecimal(undefined)), 'undefined → NaN');
  assert(isNaN(scConvertToDecimal(null)), 'null → NaN');
  assertEqual(scConvertToDecimal('0'), 0, '"0" → 0');
  assertEqual(scConvertToDecimal('  42.3  '), 42.3, 'whitespace is trimmed');
  assertEqual(scConvertToDecimal(100), 100, 'numeric input passes through');
});

// ═══════════════════════════════════════════════════════════════════════════════
// scParseRow
// ═══════════════════════════════════════════════════════════════════════════════

describe('scParseRow — parses JSON string with API fields', () => {
  const row = scParseRow(EXAMPLE_API_ROW);

  assertEqual(row.transporterId, 'DE_AMZL_TEST_XYZ1',
    'transporterId mapped from country_program_providerid_stationcode');
  assertEqual(row.delivered, '6000', 'delivered as string');
  assertEqual(row.dcr, '98.50', 'dcr_metric 0.985 → "98.50"');
  assertEqual(row.pod, '97.50', 'pod_metric 0.975 → "97.50"');
  assertEqual(row.cc, '99.00', 'cc_metric 0.99 → "99.00"');
  assertEqual(row.dnrDpmo, '300', 'dnr_dpmo mapped');
  assertEqual(row.lorDpmo, '200', 'lor_dpmo mapped');
  assertEqual(row.cdfDpmo, '1500', 'cdf_dpmo mapped');
  assertEqual(row.ce, '0', 'ce_metric mapped');
});

describe('scParseRow — metadata fields', () => {
  const row = scParseRow(EXAMPLE_API_ROW);

  assertEqual(row.week, 10, 'week preserved');
  assertEqual(row.year, 2026, 'year preserved');
  assertEqual(row.stationCode, 'XYZ1', 'station_code → stationCode');
  assertEqual(row.dspCode, 'TEST', 'dsp_code → dspCode');
  assertEqual(row.country, 'DE', 'country preserved');
  assertEqual(row.program, 'AMZL', 'program preserved');
  assertEqual(row.region, 'EU', 'region preserved');
  assertEqual(row.dataDate, '2026-03-10', 'data_date → dataDate');
  assertEqual(row.lastUpdated, '2026-03-11T08:00:00Z', 'last_updated_time → lastUpdated');
});

describe('scParseRow — missing metrics default correctly', () => {
  const row = scParseRow(JSON.stringify({ delivered: 100, station_code: 'XYZ' }));

  assertEqual(row.dcr, '-', 'missing dcr_metric → "-"');
  assertEqual(row.pod, '-', 'missing pod_metric → "-"');
  assertEqual(row.cc, '-', 'missing cc_metric → "-"');
  assertEqual(row.dnrDpmo, '0', 'missing dnr_dpmo → "0"');
  assertEqual(row.lorDpmo, '0', 'missing lor_dpmo → "0"');
  assertEqual(row.cdfDpmo, '0', 'missing cdf_dpmo → "0"');
  assertEqual(row.ce, '0', 'missing ce_metric → "0"');
});

describe('scParseRow — trims whitespace from keys', () => {
  const row = scParseRow(JSON.stringify({ ' dcr_metric': 0.99, 'station_code ': 'ABC' }));

  assertEqual(row.dcr, '99.00', 'leading-space key " dcr_metric" is trimmed');
  assertEqual(row.stationCode, 'ABC', 'trailing-space key "station_code " is trimmed');
});

describe('scParseRow — da_name mapped to daName', () => {
  const row = scParseRow(JSON.stringify({ da_name: 'John Doe', station_code: 'XYZ1' }));
  assertEqual(row.daName, 'John Doe', 'da_name → daName');

  const rowMissing = scParseRow(JSON.stringify({ station_code: 'XYZ1' }));
  assertEqual(rowMissing.daName, '', 'missing da_name → empty string');
});

describe('scParseRow — handles pre-parsed objects', () => {
  const obj = { dcr_metric: 0.97, pod_metric: 0.96, delivered: 500, station_code: 'XYZ1' };
  const row = scParseRow(obj);

  assertEqual(row.dcr, '97.00', 'object input: dcr parsed correctly');
  assertEqual(row.pod, '96.00', 'object input: pod parsed correctly');
  assertEqual(row.stationCode, 'XYZ1', 'object input: metadata preserved');
});

// ═══════════════════════════════════════════════════════════════════════════════
// scCalculateScore — MOST IMPORTANT SECTION
// ═══════════════════════════════════════════════════════════════════════════════

/*
 * Formula:
 *   totalScore = clamp(
 *     132.88 * (dcr/100) +
 *     10 * max(0, 1 - cdfDpmo/10000) -
 *     0.0024 * dnrDpmo -
 *     8.54 * ce +
 *     10 * (pod/100) +
 *     4 * (cc/100) +
 *     0.00045 * delivered -
 *     60.88,
 *     0, 100
 *   )
 *   Then: perfect override, poor-count penalty, status classification.
 */

describe('scCalculateScore — perfect scores (override path)', () => {
  // dcr=100, pod=100, cc=100, ce=0, dnrDpmo=0, lorDpmo=0, cdfDpmo=0, delivered=1000
  // Base formula: 132.88*1 + 10*1 - 0 - 0 + 10*1 + 4*1 + 0.45 - 60.88 = 96.45
  // But perfect override: all optimal → 100
  const row = {
    dcr: '100', pod: '100', cc: '100', ce: '0',
    dnrDpmo: '0', lorDpmo: '0', cdfDpmo: '0', delivered: '1000',
    transporterId: 'TEST', week: 10, year: 2026,
    stationCode: 'XYZ1', dspCode: 'TEST', dataDate: '', lastUpdated: '',
  };
  const result = scCalculateScore(row);

  assertEqual(result.totalScore, 100, 'perfect scores → totalScore = 100');
  assertEqual(result.status, 'Fantastic Plus', 'perfect scores → Fantastic Plus');
});

describe('scCalculateScore — good scores (Fantastic Plus range)', () => {
  // dcr=99.5, pod=98.0, cc=99.0, ce=0, dnrDpmo=500, lorDpmo=500, cdfDpmo=2000, delivered=5000
  // 132.88*0.995 + 10*max(0,1-0.2) - 0.0024*500 - 0 + 10*0.98 + 4*0.99 + 0.00045*5000 - 60.88
  // = 132.2156 + 8 - 1.2 + 9.8 + 3.96 + 2.25 - 60.88 = 94.1456 → 94.15
  // poorCount=0 (all KPIs in acceptable range)
  const row = {
    dcr: '99.5', pod: '98.0', cc: '99.0', ce: '0',
    dnrDpmo: '500', lorDpmo: '500', cdfDpmo: '2000', delivered: '5000',
    transporterId: 'TEST', week: 10, year: 2026,
    stationCode: 'XYZ1', dspCode: 'TEST', dataDate: '', lastUpdated: '',
  };
  const result = scCalculateScore(row);

  assertClose(result.totalScore, 94.15, 0.01, 'good scores → ~94.15');
  assertEqual(result.status, 'Fantastic Plus', 'good scores → Fantastic Plus');
});

describe('scCalculateScore — fair/mediocre (Great range)', () => {
  // dcr=97.5, pod=95.0, cc=80.0, ce=0, dnrDpmo=1200, lorDpmo=1000, cdfDpmo=5000, delivered=3000
  // 132.88*0.975 + 10*max(0,1-0.5) - 0.0024*1200 - 0 + 10*0.95 + 4*0.80 + 0.00045*3000 - 60.88
  // = 129.558 + 5 - 2.88 + 9.5 + 3.2 + 1.35 - 60.88 = 84.858 → 84.86
  // poorCount=0 (dcr=97.5≥97, dnr=1200<1500, pod=95≥94, cc=80≥70, ce=0, cdf=5000<8000)
  const row = {
    dcr: '97.5', pod: '95.0', cc: '80.0', ce: '0',
    dnrDpmo: '1200', lorDpmo: '1000', cdfDpmo: '5000', delivered: '3000',
    transporterId: 'TEST', week: 10, year: 2026,
    stationCode: 'XYZ1', dspCode: 'TEST', dataDate: '', lastUpdated: '',
  };
  const result = scCalculateScore(row);

  assertClose(result.totalScore, 84.85, 0.01, 'mediocre scores → ~84.85');
  assertEqual(result.status, 'Great', 'mediocre scores → Great (< 85)');
});

describe('scCalculateScore — single poor KPI (capped at 85-penalty)', () => {
  // dcr=96.0, pod=98.0, cc=99.0, ce=0, dnrDpmo=500, lorDpmo=0, cdfDpmo=2000, delivered=3000
  // Base: 132.88*0.96 + 10*0.8 - 1.2 - 0 + 9.8 + 3.96 + 1.35 - 60.88
  // = 127.5648 + 8 - 1.2 + 9.8 + 3.96 + 1.35 - 60.88 = 88.5948 → 88.59
  // poorCount=1 (dcr=96 < 97)
  // severity: (97-96)/5 = 0.2
  // penalty = min(3, 0.2) = 0.2
  // cap = min(88.59, 85-0.2) = min(88.59, 84.8) = 84.8
  const row = {
    dcr: '96.0', pod: '98.0', cc: '99.0', ce: '0',
    dnrDpmo: '500', lorDpmo: '0', cdfDpmo: '2000', delivered: '3000',
    transporterId: 'TEST', week: 10, year: 2026,
    stationCode: 'XYZ1', dspCode: 'TEST', dataDate: '', lastUpdated: '',
  };
  const result = scCalculateScore(row);

  assertClose(result.totalScore, 84.8, 0.01, 'single poor KPI → capped at ~84.8');
  assertEqual(result.status, 'Great', 'single poor KPI → Great (< 85)');
});

describe('scCalculateScore — multiple poor KPIs (capped at 70-penalty)', () => {
  // dcr=95.0, pod=92.0, cc=65.0, ce=2, dnrDpmo=2000, lorDpmo=0, cdfDpmo=9000, delivered=2000
  // Base: 132.88*0.95 + 10*max(0,1-0.9) - 0.0024*2000 - 8.54*2 + 10*0.92 + 4*0.65 + 0.00045*2000 - 60.88
  // = 126.236 + 1 - 4.8 - 17.08 + 9.2 + 2.6 + 0.9 - 60.88 = 57.176 → 57.18
  // poorCount=6 (dcr<97, dnr≥1500, pod<94, cc<70, ce≠0, cdf≥8000)
  // severity: (97-95)/5=0.4 + (2000-1500)/1000=0.5 + (94-92)/10=0.2 + (70-65)/50=0.1 + 2*1=2 + (9000-8000)/2000=0.5 = 3.7
  // penalty = min(3, 3.7) = 3
  // cap = min(57.18, 70-3) = min(57.18, 67) = 57.18 (already below cap)
  const row = {
    dcr: '95.0', pod: '92.0', cc: '65.0', ce: '2',
    dnrDpmo: '2000', lorDpmo: '0', cdfDpmo: '9000', delivered: '2000',
    transporterId: 'TEST', week: 10, year: 2026,
    stationCode: 'XYZ1', dspCode: 'TEST', dataDate: '', lastUpdated: '',
  };
  const result = scCalculateScore(row);

  assertClose(result.totalScore, 57.18, 0.01, 'multiple poor KPIs → ~57.18 (below 67 cap)');
  assertEqual(result.status, 'Fair', 'multiple poor KPIs → Fair');
});

describe('scCalculateScore — multiple poor KPIs (cap actually limits score)', () => {
  // Moderate base score but ≥2 poor KPIs to show capping effect
  // dcr=96.5, pod=93.5, cc=95.0, ce=0, dnrDpmo=400, lorDpmo=0, cdfDpmo=3000, delivered=4000
  // Base: 132.88*0.965 + 10*0.7 - 0.96 - 0 + 10*0.935 + 4*0.95 + 1.8 - 60.88
  // = 128.2292 + 7 - 0.96 + 9.35 + 3.8 + 1.8 - 60.88 = 88.3392
  // poorCount=2 (dcr=96.5<97, pod=93.5<94)
  // severity: (97-96.5)/5=0.1 + (94-93.5)/10=0.05 = 0.15
  // penalty = min(3, 0.15) = 0.15
  // cap = min(88.34, 70-0.15) = min(88.34, 69.85) = 69.85
  const row = {
    dcr: '96.5', pod: '93.5', cc: '95.0', ce: '0',
    dnrDpmo: '400', lorDpmo: '0', cdfDpmo: '3000', delivered: '4000',
    transporterId: 'TEST', week: 10, year: 2026,
    stationCode: 'XYZ1', dspCode: 'TEST', dataDate: '', lastUpdated: '',
  };
  const result = scCalculateScore(row);

  assertClose(result.totalScore, 69.85, 0.01, '2 poor KPIs with high base → capped at ~69.85');
  assertEqual(result.status, 'Fair', 'capped score 69.85 → Fair');
});

describe('scCalculateScore — all dash/missing values', () => {
  // dcr="-", pod="-", cc="-" → defaults to 100 each
  // dnrDpmo=0, lorDpmo=0, cdfDpmo=0, ce=0, delivered=0
  // Perfect override: dcr=1, pod=1, cc=1, cdfDpmo=0, ce=0, dnrDpmo=0, lorDpmo=0 → 100
  const row = {
    dcr: '-', pod: '-', cc: '-', ce: '0',
    dnrDpmo: '0', lorDpmo: '0', cdfDpmo: '0', delivered: '0',
    transporterId: '', week: '', year: '',
    stationCode: '', dspCode: '', dataDate: '', lastUpdated: '',
  };
  const result = scCalculateScore(row);

  assertEqual(result.totalScore, 100, 'all dash values → 100 (perfect override)');
  assertEqual(result.status, 'Fantastic Plus', 'all dash values → Fantastic Plus');
});

describe('scCalculateScore — zero delivered', () => {
  // dcr=99, pod=97, cc=98, ce=0, dnrDpmo=500, lorDpmo=200, cdfDpmo=3000, delivered=0
  // 132.88*0.99 + 10*max(0,1-0.3) - 0.0024*500 - 0 + 10*0.97 + 4*0.98 + 0 - 60.88
  // = 131.5512 + 7 - 1.2 + 9.7 + 3.92 + 0 - 60.88 = 90.0912 → 90.09
  // poorCount=0, no penalty
  const row = {
    dcr: '99', pod: '97', cc: '98', ce: '0',
    dnrDpmo: '500', lorDpmo: '200', cdfDpmo: '3000', delivered: '0',
    transporterId: 'TEST', week: 10, year: 2026,
    stationCode: 'XYZ1', dspCode: 'TEST', dataDate: '', lastUpdated: '',
  };
  const result = scCalculateScore(row);

  assertClose(result.totalScore, 90.09, 0.01, 'zero delivered → ~90.09 (no crash)');
  assertEqual(result.status, 'Fantastic', 'zero delivered → Fantastic');
});

describe('scCalculateScore — CE effect (ce=0 vs ce=3)', () => {
  const base = {
    dcr: '99', pod: '97', cc: '98',
    dnrDpmo: '500', lorDpmo: '200', cdfDpmo: '3000', delivered: '3000',
    transporterId: 'TEST', week: 10, year: 2026,
    stationCode: 'XYZ1', dspCode: 'TEST', dataDate: '', lastUpdated: '',
  };

  const ce0 = scCalculateScore({ ...base, ce: '0' });
  const ce3 = scCalculateScore({ ...base, ce: '3' });

  // ce=0: 131.5512 + 7 - 1.2 - 0 + 9.7 + 3.92 + 1.35 - 60.88 = 91.4412 → 91.44
  assertClose(ce0.totalScore, 91.44, 0.01, 'ce=0 → ~91.44');
  assertEqual(ce0.status, 'Fantastic', 'ce=0 → Fantastic');

  // ce=3: 91.4412 - 8.54*3 = 91.4412 - 25.62 = 65.8212 → 65.82
  // poorCount=1 (ce≠0), severity=3, penalty=min(3,3)=3, cap=min(65.82, 85-3)=65.82
  assertClose(ce3.totalScore, 65.82, 0.01, 'ce=3 → ~65.82');
  assertEqual(ce3.status, 'Fair', 'ce=3 → Fair');

  assert(ce0.totalScore - ce3.totalScore > 20,
    'CE=3 drops score by >20 points vs CE=0');
});

describe('scCalculateScore — status classification boundaries', () => {
  // We construct rows that produce scores near each boundary

  // Poor: score < 40
  // Use very bad KPIs to get a very low score
  // dcr=90, pod=85, cc=50, ce=5, dnrDpmo=3000, cdfDpmo=15000, delivered=100
  // 132.88*0.90 + 10*max(0,1-1.5) - 0.0024*3000 - 8.54*5 + 10*0.85 + 4*0.50 + 0.045 - 60.88
  // = 119.592 + 0 - 7.2 - 42.7 + 8.5 + 2.0 + 0.045 - 60.88 = 19.357
  // poorCount: dcr<97 ✓, dnr≥1500 ✓, pod<94 ✓, cc<70 ✓, ce≠0 ✓, cdf≥8000 ✓ → 6
  // cap: min(19.36, 67) = 19.36
  const poorRow = {
    dcr: '90', pod: '85', cc: '50', ce: '5',
    dnrDpmo: '3000', lorDpmo: '0', cdfDpmo: '15000', delivered: '100',
    transporterId: '', week: '', year: '',
    stationCode: '', dspCode: '', dataDate: '', lastUpdated: '',
  };
  const poorResult = scCalculateScore(poorRow);
  assert(poorResult.totalScore < 40, `poor row score ${poorResult.totalScore} < 40`);
  assertEqual(poorResult.status, 'Poor', 'very bad metrics → Poor status');

  // Fair: 40 ≤ score < 70 — already tested in "multiple poor KPIs" (57.18)

  // Great: 70 ≤ score < 85 — already tested in "single poor KPI" (84.8)

  // Fantastic: 85 ≤ score < 93 — already tested in "zero delivered" (90.09)

  // Fantastic Plus: score ≥ 93 — already tested in "good scores" (94.15)

  // Verify near-boundary: 39.99 rounded
  assert(poorResult.status === 'Poor', 'status for score well below 40 is Poor');
});

describe('scCalculateScore — output field formatting', () => {
  const row = {
    dcr: '99.5', pod: '98.0', cc: '99.0', ce: '0',
    dnrDpmo: '500', lorDpmo: '500', cdfDpmo: '2000', delivered: '5000',
    transporterId: 'TEST_ID', week: 10, year: 2026,
    stationCode: 'XYZ1', dspCode: 'TEST', dataDate: '2026-03-10', lastUpdated: '2026-03-11',
  };
  const result = scCalculateScore(row);

  assertEqual(result.dcr, '99.50', 'dcr formatted to 2dp string');
  assertEqual(result.pod, '98.00', 'pod formatted to 2dp string');
  assertEqual(result.cc, '99.00', 'cc formatted to 2dp string');
  assertEqual(result.dnrDpmo, '500.00', 'dnrDpmo formatted to 2dp string');
  assertEqual(result.lorDpmo, '500.00', 'lorDpmo formatted to 2dp string');
  assertEqual(result.cdfDpmo, '2000.00', 'cdfDpmo formatted to 2dp string');
  assertEqual(result.ce, '0.00', 'ce formatted to 2dp string');
  assertEqual(result.transporterId, 'TEST_ID', 'transporterId passed through');
  assertEqual(result.daName, undefined, 'daName passed through (undefined when not set)');
  assertEqual(result.delivered, '5000', 'delivered passed through as string');
  assertEqual(result.week, 10, 'week metadata passed through');
  assertEqual(result.stationCode, 'XYZ1', 'stationCode metadata passed through');
  assert(result.originalData !== undefined, 'originalData preserved');
  assertEqual(result.originalData.dcr, '99.5', 'originalData.dcr is the raw input');
});

describe('scCalculateScore — daName passed through', () => {
  const row = {
    dcr: '99', pod: '97', cc: '98', ce: '0',
    dnrDpmo: '500', lorDpmo: '200', cdfDpmo: '3000', delivered: '1000',
    transporterId: 'TEST', daName: 'Jane Smith', week: 10, year: 2026,
    stationCode: 'XYZ1', dspCode: 'TEST', dataDate: '', lastUpdated: '',
  };
  const result = scCalculateScore(row);

  assertEqual(result.daName, 'Jane Smith', 'daName passed through from row');
});

// ═══════════════════════════════════════════════════════════════════════════════
// scKpiClass
// ═══════════════════════════════════════════════════════════════════════════════

describe('scKpiClass — DCR thresholds', () => {
  assertEqual(scKpiClass(96.9, 'DCR'), 'poor',      'DCR 96.9 → poor');
  assertEqual(scKpiClass(97.0, 'DCR'), 'fair',       'DCR 97.0 → fair');
  assertEqual(scKpiClass(98.0, 'DCR'), 'fair',       'DCR 98.0 → fair');
  assertEqual(scKpiClass(98.5, 'DCR'), 'great',      'DCR 98.5 → great');
  assertEqual(scKpiClass(99.4, 'DCR'), 'great',      'DCR 99.4 → great');
  assertEqual(scKpiClass(99.5, 'DCR'), 'fantastic',   'DCR 99.5 → fantastic');
  assertEqual(scKpiClass(100, 'DCR'),  'fantastic',   'DCR 100 → fantastic');
});

describe('scKpiClass — DNRDPMO thresholds', () => {
  assertEqual(scKpiClass(0, 'DNRDPMO'),     'fantastic', 'DNRDPMO 0 → fantastic');
  assertEqual(scKpiClass(1099, 'DNRDPMO'),  'fantastic', 'DNRDPMO 1099 → fantastic');
  assertEqual(scKpiClass(1100, 'DNRDPMO'),  'great',     'DNRDPMO 1100 → great');
  assertEqual(scKpiClass(1299, 'DNRDPMO'),  'great',     'DNRDPMO 1299 → great');
  assertEqual(scKpiClass(1300, 'DNRDPMO'),  'fair',      'DNRDPMO 1300 → fair');
  assertEqual(scKpiClass(1499, 'DNRDPMO'),  'fair',      'DNRDPMO 1499 → fair');
  assertEqual(scKpiClass(1500, 'DNRDPMO'),  'poor',      'DNRDPMO 1500 → poor');
  assertEqual(scKpiClass(3000, 'DNRDPMO'),  'poor',      'DNRDPMO 3000 → poor');
});

describe('scKpiClass — LORDPMO thresholds (same as DNRDPMO)', () => {
  assertEqual(scKpiClass(500, 'LORDPMO'),   'fantastic', 'LORDPMO 500 → fantastic');
  assertEqual(scKpiClass(1200, 'LORDPMO'),  'great',     'LORDPMO 1200 → great');
  assertEqual(scKpiClass(1400, 'LORDPMO'),  'fair',      'LORDPMO 1400 → fair');
  assertEqual(scKpiClass(2000, 'LORDPMO'),  'poor',      'LORDPMO 2000 → poor');
});

describe('scKpiClass — POD thresholds', () => {
  assertEqual(scKpiClass(93.9, 'POD'),  'poor',      'POD 93.9 → poor');
  assertEqual(scKpiClass(94.0, 'POD'),  'fair',       'POD 94.0 → fair');
  assertEqual(scKpiClass(95.4, 'POD'),  'fair',       'POD 95.4 → fair');
  assertEqual(scKpiClass(95.5, 'POD'),  'great',      'POD 95.5 → great');
  assertEqual(scKpiClass(96.9, 'POD'),  'great',      'POD 96.9 → great');
  assertEqual(scKpiClass(97.0, 'POD'),  'fantastic',   'POD 97.0 → fantastic');
  assertEqual(scKpiClass(100, 'POD'),   'fantastic',   'POD 100 → fantastic');
});

describe('scKpiClass — CC thresholds', () => {
  assertEqual(scKpiClass(69.9, 'CC'),  'poor',      'CC 69.9 → poor');
  assertEqual(scKpiClass(70.0, 'CC'),  'fair',       'CC 70.0 → fair');
  assertEqual(scKpiClass(94.9, 'CC'),  'fair',       'CC 94.9 → fair');
  assertEqual(scKpiClass(95.0, 'CC'),  'great',      'CC 95.0 → great');
  assertEqual(scKpiClass(98.4, 'CC'),  'great',      'CC 98.4 → great');
  assertEqual(scKpiClass(98.5, 'CC'),  'fantastic',   'CC 98.5 → fantastic');
  assertEqual(scKpiClass(100, 'CC'),   'fantastic',   'CC 100 → fantastic');
});

describe('scKpiClass — CE thresholds', () => {
  assertEqual(scKpiClass(0, 'CE'),   'fantastic', 'CE 0 → fantastic');
  assertEqual(scKpiClass(1, 'CE'),   'poor',      'CE 1 → poor');
  assertEqual(scKpiClass(5, 'CE'),   'poor',      'CE 5 → poor');
  assertEqual(scKpiClass(0.5, 'CE'), 'poor',      'CE 0.5 → poor (any non-zero)');
});

describe('scKpiClass — CDFDPMO thresholds', () => {
  assertEqual(scKpiClass(0, 'CDFDPMO'),     'fantastic', 'CDFDPMO 0 → fantastic');
  assertEqual(scKpiClass(3680, 'CDFDPMO'),  'fantastic', 'CDFDPMO 3680 → fantastic');
  assertEqual(scKpiClass(3681, 'CDFDPMO'),  'great',     'CDFDPMO 3681 → great');
  assertEqual(scKpiClass(4450, 'CDFDPMO'),  'great',     'CDFDPMO 4450 → great');
  assertEqual(scKpiClass(4451, 'CDFDPMO'),  'fair',      'CDFDPMO 4451 → fair');
  assertEqual(scKpiClass(5460, 'CDFDPMO'),  'fair',      'CDFDPMO 5460 → fair');
  assertEqual(scKpiClass(5461, 'CDFDPMO'),  'poor',      'CDFDPMO 5461 → poor');
  assertEqual(scKpiClass(10000, 'CDFDPMO'), 'poor',      'CDFDPMO 10000 → poor');
});

describe('scKpiClass — unknown type', () => {
  assertEqual(scKpiClass(50, 'UNKNOWN'), '', 'unknown type → empty string');
});

// ═══════════════════════════════════════════════════════════════════════════════
// scStatusClass
// ═══════════════════════════════════════════════════════════════════════════════

describe('scStatusClass — status to CSS class mapping', () => {
  assertEqual(scStatusClass('Poor'), 'poor', "'Poor' → 'poor'");
  assertEqual(scStatusClass('Fair'), 'fair', "'Fair' → 'fair'");
  assertEqual(scStatusClass('Great'), 'great', "'Great' → 'great'");
  assertEqual(scStatusClass('Fantastic'), 'fantastic', "'Fantastic' → 'fantastic'");
  assertEqual(scStatusClass('Fantastic Plus'), 'fantastic', "'Fantastic Plus' → 'fantastic'");
  assertEqual(scStatusClass('Unknown'), '', "unknown status → empty string");
  assertEqual(scStatusClass(''), '', "empty string → empty string");
});

// ═══════════════════════════════════════════════════════════════════════════════
// scParseApiResponse
// ═══════════════════════════════════════════════════════════════════════════════

describe('scParseApiResponse — valid response with rows', () => {
  const apiResponse = {
    tableData: {
      da_dsp_station_weekly_quality: {
        rows: [
          EXAMPLE_API_ROW,
          JSON.stringify({
            dcr_metric: 0.99, pod_metric: 0.97, cc_metric: 0.95,
            dnr_dpmo: 100, lor_dpmo: 50, cdf_dpmo: 2000, ce_metric: 0,
            delivered: 4000, week: 11, year: 2026, station_code: 'XYZ1',
            dsp_code: 'TEST',
          }),
        ],
      },
    },
  };
  const records = scParseApiResponse(apiResponse);

  assertEqual(records.length, 2, 'parses two rows');
  assertEqual(records[0].stationCode, 'XYZ1', 'first row station code');
  assertEqual(records[1].week, 11, 'second row week');
  assertEqual(records[0].dcr, '98.50', 'first row dcr mapped');
  assertEqual(records[1].dcr, '99.00', 'second row dcr mapped');
});

describe('scParseApiResponse — missing tableData', () => {
  assertEqual(scParseApiResponse({}), [], 'empty object → empty array');
  assertEqual(scParseApiResponse({ tableData: {} }), [],
    'tableData without da_dsp_station_weekly_quality → empty array');
});

describe('scParseApiResponse — empty rows array', () => {
  const resp = { tableData: { da_dsp_station_weekly_quality: { rows: [] } } };
  assertEqual(scParseApiResponse(resp), [], 'empty rows → empty array');
});

describe('scParseApiResponse — malformed JSON rows skipped', () => {
  const resp = {
    tableData: {
      da_dsp_station_weekly_quality: {
        rows: [
          'not valid json{{{',
          EXAMPLE_API_ROW,
          '}{broken',
        ],
      },
    },
  };
  const records = scParseApiResponse(resp);

  assertEqual(records.length, 1, 'only valid row parsed (malformed skipped)');
  assertEqual(records[0].stationCode, 'XYZ1', 'valid row data preserved');
});

describe('scParseApiResponse — null/undefined input', () => {
  assertEqual(scParseApiResponse(null), [], 'null → empty array');
  assertEqual(scParseApiResponse(undefined), [], 'undefined → empty array');
});

// ═══════════════════════════════════════════════════════════════════════════════
// scValidateWeek
// ═══════════════════════════════════════════════════════════════════════════════

describe('scValidateWeek — valid and invalid inputs', () => {
  assertEqual(scValidateWeek('2026-W10'), null,
    'valid week → null');
  assertEqual(scValidateWeek('2026-W01'), null,
    'valid week W01 → null');

  assert(!!scValidateWeek(''),
    'empty string → error message');
  assert(!!scValidateWeek(null),
    'null → error message');
  assert(!!scValidateWeek(undefined),
    'undefined → error message');

  assert(!!scValidateWeek('2026-10'),
    'invalid format "2026-10" → error');
  assert(!!scValidateWeek('W10-2026'),
    'wrong order "W10-2026" → error');
  assert(!!scValidateWeek('2026W10'),
    'missing dash "2026W10" → error');

  assertEqual(scValidateWeek('2026-W12'), null,
    'valid week W12 → null');
});

// ═══════════════════════════════════════════════════════════════════════════════
// scCurrentWeek / scWeeksAgo
// ═══════════════════════════════════════════════════════════════════════════════

describe('scCurrentWeek — returns valid ISO week format', () => {
  const week = scCurrentWeek();
  assert(/^\d{4}-W\d{2}$/.test(week),
    `scCurrentWeek() "${week}" matches YYYY-Www format`);
});

describe('scWeeksAgo — returns valid ISO week format and is before current', () => {
  const current = scCurrentWeek();
  const oneAgo = scWeeksAgo(1);
  const fourAgo = scWeeksAgo(4);

  assert(/^\d{4}-W\d{2}$/.test(oneAgo),
    `scWeeksAgo(1) "${oneAgo}" matches YYYY-Www format`);
  assert(/^\d{4}-W\d{2}$/.test(fourAgo),
    `scWeeksAgo(4) "${fourAgo}" matches YYYY-Www format`);
  assert(oneAgo <= current,
    `scWeeksAgo(1) "${oneAgo}" ≤ current "${current}"`);
  assert(fourAgo <= oneAgo,
    `scWeeksAgo(4) "${fourAgo}" ≤ scWeeksAgo(1) "${oneAgo}"`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error('\nFailed tests:');
  failures.forEach((f) => console.error(`  • ${f}`));
  process.exit(1);
} else {
  console.log('All tests passed ✅');
}
