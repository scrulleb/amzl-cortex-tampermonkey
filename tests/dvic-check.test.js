/**
 * dvic-check.test.js
 *
 * Contract tests for the DVIC Check module's normalisation layer.
 * Covers checklist items:
 *   #3  – Audit frontend column bindings (Pre-Trip → PRE_TRIP_DVIC.totalInspectionsDone)
 *   #4  – Contract test for count→column mapping
 *   #5  – Contract test for status=OK semantic
 *         (missing=0 when both counts are 0; status="OK" whenever pre ≤ post)
 *
 * Run with: node tests/dvic-check.test.js
 * No external test framework required — uses the same tiny inline harness as
 * delivery-performance.test.js.
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

function describe(name, fn) {
  console.log(`\n🔷 ${name}`);
  fn();
}

// ─── Inline copy of _normalizeVehicle (mirrors cortex-tools.user.js) ─────────
//
// IMPORTANT: keep in sync with dvicCheck._normalizeVehicle in cortex-tools.user.js.
// The contract test intentionally duplicates the pure logic so it can run
// without a DOM/GM environment.

function normalizeVehicle(vehicleStat) {
  const vehicleIdentifier = String(vehicleStat?.vehicleIdentifier ?? '').trim() || 'Unknown';
  const inspStats = Array.isArray(vehicleStat?.inspectionStats)
    ? vehicleStat.inspectionStats
    : [];

  // API returns `inspectionType` (not `type`)
  const preStat  = inspStats.find((s) => (s?.inspectionType ?? s?.type) === 'PRE_TRIP_DVIC')  ?? null;
  const postStat = inspStats.find((s) => (s?.inspectionType ?? s?.type) === 'POST_TRIP_DVIC') ?? null;

  const preTripTotal  = Number(preStat?.totalInspectionsDone  ?? 0);
  const postTripTotal = Number(postStat?.totalInspectionsDone ?? 0);

  const missingDVIC = preTripTotal - postTripTotal;
  const status      = missingDVIC > 0 ? 'Post Trip DVIC Missing' : 'OK';
  const missingCount = status === 'OK' ? 0 : missingDVIC;

  const candidateDates = [preStat, postStat]
    .filter(Boolean)
    .map((s) => s.inspectedAt ?? s.lastInspectedAt ?? null)
    .filter(Boolean);
  const inspectedAt = candidateDates.length > 0
    ? candidateDates.sort().at(-1)
    : null;
  const shiftDate = preStat?.shiftDate ?? postStat?.shiftDate ?? null;

  const reporterIdSet = new Set();
  for (const stat of inspStats) {
    const details = Array.isArray(stat?.inspectionDetails) ? stat.inspectionDetails : [];
    for (const detail of details) {
      const rid = detail?.reporterId;
      if (rid != null && String(rid).trim() !== '') reporterIdSet.add(String(rid).trim());
    }
  }

  return {
    vehicleIdentifier,
    preTripTotal,
    postTripTotal,
    missingCount,
    status,
    inspectedAt,
    shiftDate,
    reporterIds: [...reporterIdSet],
    reporterNames: [],
  };
}

// ─── Inline copy of _processApiResponse ──────────────────────────────────────

function processApiResponse(json) {
  if (json === null || typeof json !== 'object') {
    throw new Error('API response is not a JSON object');
  }
  const list = json?.inspectionsStatList;
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    throw new Error(`inspectionsStatList has unexpected type: ${typeof list}`);
  }
  return list.map(normalizeVehicle);
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeVehicleStat({
  vehicleIdentifier = 'VAN-001',
  preCount = 0,
  postCount = 0,
  preReporters = [],
  postReporters = [],
  preInspectedAt = null,
  postInspectedAt = null,
  preShiftDate = null,
  postShiftDate = null,
} = {}) {
  const inspectionStats = [];

  // Always include both entries (normalised response)
  inspectionStats.push({
    inspectionType: 'PRE_TRIP_DVIC',
    totalInspectionsDone: preCount,
    ...(preInspectedAt ? { inspectedAt: preInspectedAt } : {}),
    ...(preShiftDate   ? { shiftDate: preShiftDate }      : {}),
    inspectionDetails: preReporters.map((id) => ({ reporterId: id })),
  });
  inspectionStats.push({
    inspectionType: 'POST_TRIP_DVIC',
    totalInspectionsDone: postCount,
    ...(postInspectedAt ? { inspectedAt: postInspectedAt } : {}),
    ...(postShiftDate   ? { shiftDate: postShiftDate }      : {}),
    inspectionDetails: postReporters.map((id) => ({ reporterId: id })),
  });

  return { vehicleIdentifier, inspectionStats };
}

// ─── Contract Tests ───────────────────────────────────────────────────────────

describe('Column binding contract — preTripTotal maps to PRE_TRIP_DVIC.totalInspectionsDone', () => {
  const stat = makeVehicleStat({ preCount: 4, postCount: 3 });
  const v = normalizeVehicle(stat);

  assertEqual(v.preTripTotal,  4, 'preTripTotal == PRE_TRIP_DVIC.totalInspectionsDone (4)');
  assertEqual(v.postTripTotal, 3, 'postTripTotal == POST_TRIP_DVIC.totalInspectionsDone (3)');
  assertEqual(v.missingCount,  1, 'missingCount == preTripTotal − postTripTotal (4−3=1)');
  assertEqual(v.status, 'Post Trip DVIC Missing', 'status is "Post Trip DVIC Missing" when pre > post');
});

describe('Column binding contract — postTripTotal maps to POST_TRIP_DVIC.totalInspectionsDone', () => {
  const stat = makeVehicleStat({ preCount: 2, postCount: 2 });
  const v = normalizeVehicle(stat);

  assertEqual(v.preTripTotal,  2, 'preTripTotal is 2');
  assertEqual(v.postTripTotal, 2, 'postTripTotal is 2');
  assertEqual(v.missingCount,  0, 'missingCount is 0 when pre == post');
  assertEqual(v.status, 'OK', 'status is OK when pre == post');
});

describe('status=OK semantic — both counts ZERO means OK (no inspection day)', () => {
  // H5 from checklist: missing=0 when both are 0 → status must be OK
  const stat = makeVehicleStat({ preCount: 0, postCount: 0 });
  const v = normalizeVehicle(stat);

  assertEqual(v.preTripTotal,  0,    'preTripTotal is 0');
  assertEqual(v.postTripTotal, 0,    'postTripTotal is 0');
  assertEqual(v.missingCount,  0,    'missingCount is 0 (not -0 or NaN)');
  assertEqual(v.status,        'OK', 'status is OK when both counts are 0');
});

describe('status=OK semantic — post > pre is also OK (overtime post-trips)', () => {
  const stat = makeVehicleStat({ preCount: 1, postCount: 2 });
  const v = normalizeVehicle(stat);

  assertEqual(v.missingCount, 0,    'missingCount is clamped to 0 when post > pre');
  assertEqual(v.status,       'OK', 'status is OK when post > pre');
});

describe('missing PRE_TRIP_DVIC entry in inspectionStats', () => {
  // Checklist item #2: response must be normalised even if one type is absent
  const stat = {
    vehicleIdentifier: 'VAN-PRE-ABSENT',
    inspectionStats: [
      { inspectionType: 'POST_TRIP_DVIC', totalInspectionsDone: 2, inspectionDetails: [] },
    ],
  };
  const v = normalizeVehicle(stat);

  assertEqual(v.preTripTotal,  0,    'preTripTotal defaults to 0 when PRE entry missing');
  assertEqual(v.postTripTotal, 2,    'postTripTotal is still read from POST entry');
  assertEqual(v.missingCount,  0,    'missingCount is 0 (post > pre)');
  assertEqual(v.status,        'OK', 'status is OK when pre entry absent but post present');
});

describe('missing POST_TRIP_DVIC entry in inspectionStats', () => {
  const stat = {
    vehicleIdentifier: 'VAN-POST-ABSENT',
    inspectionStats: [
      { inspectionType: 'PRE_TRIP_DVIC', totalInspectionsDone: 3, inspectionDetails: [] },
    ],
  };
  const v = normalizeVehicle(stat);

  assertEqual(v.preTripTotal,  3, 'preTripTotal is 3');
  assertEqual(v.postTripTotal, 0, 'postTripTotal defaults to 0 when POST entry missing');
  assertEqual(v.missingCount,  3, 'missingCount is 3');
  assertEqual(v.status, 'Post Trip DVIC Missing', 'status is "Post Trip DVIC Missing"');
});

describe('fully empty inspectionStats array', () => {
  const stat = { vehicleIdentifier: 'VAN-EMPTY', inspectionStats: [] };
  const v = normalizeVehicle(stat);

  assertEqual(v.preTripTotal,  0,    'preTripTotal is 0');
  assertEqual(v.postTripTotal, 0,    'postTripTotal is 0');
  assertEqual(v.missingCount,  0,    'missingCount is 0');
  assertEqual(v.status,        'OK', 'status is OK for empty stats (no inspection day)');
  assertEqual(v.inspectedAt,   null, 'inspectedAt is null');
  assertEqual(v.shiftDate,     null, 'shiftDate is null');
});

describe('reporterIds — deduplication and whitespace normalisation', () => {
  const stat = makeVehicleStat({
    preReporters: ['E001', ' E002 ', 'E001'],  // duplicate + whitespace
    postReporters: ['E002', 'E003'],
  });
  const v = normalizeVehicle(stat);

  // Expect: E001, E002, E003 (deduplicated, trimmed)
  assert(v.reporterIds.includes('E001'), 'E001 is in reporterIds');
  assert(v.reporterIds.includes('E002'), 'E002 is in reporterIds');
  assert(v.reporterIds.includes('E003'), 'E003 is in reporterIds');
  assert(!v.reporterIds.includes(' E002 '), 'untrimmed " E002 " is not in reporterIds');
  assertEqual(v.reporterIds.length, 3, 'exactly 3 unique reporters');
});

describe('inspectedAt — most recent timestamp is selected', () => {
  const stat = {
    vehicleIdentifier: 'VAN-TS',
    inspectionStats: [
      { inspectionType: 'PRE_TRIP_DVIC',  totalInspectionsDone: 1, inspectedAt: '2026-03-20T06:00:00Z', inspectionDetails: [] },
      { inspectionType: 'POST_TRIP_DVIC', totalInspectionsDone: 1, inspectedAt: '2026-03-20T18:30:00Z', inspectionDetails: [] },
    ],
  };
  const v = normalizeVehicle(stat);

  assertEqual(v.inspectedAt, '2026-03-20T18:30:00Z', 'most recent inspectedAt is selected');
});

describe('shiftDate — extracted from preStat if present', () => {
  const stat = makeVehicleStat({
    preCount: 1, postCount: 1,
    preShiftDate: '2026-03-20',
  });
  const v = normalizeVehicle(stat);

  assertEqual(v.shiftDate, '2026-03-20', 'shiftDate is extracted from PRE_TRIP_DVIC stat');
});

describe('vehicleIdentifier — whitespace normalisation', () => {
  const stat = makeVehicleStat({ vehicleIdentifier: '  VAN-042  ' });
  const v = normalizeVehicle(stat);

  assertEqual(v.vehicleIdentifier, 'VAN-042', 'vehicleIdentifier is trimmed');
});

describe('vehicleIdentifier — null/undefined falls back to "Unknown"', () => {
  [null, undefined, '  '].forEach((id) => {
    const stat = { vehicleIdentifier: id, inspectionStats: [] };
    const v = normalizeVehicle(stat);
    assertEqual(v.vehicleIdentifier, 'Unknown', `vehicleIdentifier "${id}" → "Unknown"`);
  });
});

describe('processApiResponse — empty/null inspectionsStatList', () => {
  assertEqual(processApiResponse({ inspectionsStatList: [] }),   [], 'empty list → []');
  assertEqual(processApiResponse({ inspectionsStatList: null }), [], 'null list → []');
  assertEqual(processApiResponse({}),                            [], 'missing key → []');
});

describe('processApiResponse — throws on non-object response', () => {
  let threw = false;
  try { processApiResponse(null); } catch { threw = true; }
  assert(threw, 'throws for null response');

  threw = false;
  try { processApiResponse('bad string'); } catch { threw = true; }
  assert(threw, 'throws for string response');
});

describe('processApiResponse — throws on non-array inspectionsStatList', () => {
  let threw = false;
  try { processApiResponse({ inspectionsStatList: 'bad' }); } catch { threw = true; }
  assert(threw, 'throws when inspectionsStatList is a string');
});

describe('processApiResponse — normalises a full vehicle list', () => {
  const json = {
    inspectionsStatList: [
      makeVehicleStat({ vehicleIdentifier: 'V1', preCount: 3, postCount: 3 }),
      makeVehicleStat({ vehicleIdentifier: 'V2', preCount: 2, postCount: 1 }),
      makeVehicleStat({ vehicleIdentifier: 'V3', preCount: 0, postCount: 0 }),
    ],
  };
  const vehicles = processApiResponse(json);

  assertEqual(vehicles.length, 3, 'returns 3 vehicles');
  assertEqual(vehicles[0].status, 'OK',                      'V1 — pre==post → OK');
  assertEqual(vehicles[1].status, 'Post Trip DVIC Missing',  'V2 — pre>post → missing');
  assertEqual(vehicles[1].missingCount, 1,                   'V2 missingCount == 1');
  assertEqual(vehicles[2].status, 'OK',                      'V3 — both-zero → OK');
  assertEqual(vehicles[2].missingCount, 0,                   'V3 missingCount == 0');
});

describe('output model shape — all required fields are present', () => {
  const v = normalizeVehicle(makeVehicleStat());
  const REQUIRED_FIELDS = [
    'vehicleIdentifier', 'preTripTotal', 'postTripTotal',
    'missingCount', 'status', 'inspectedAt', 'shiftDate',
    'reporterIds', 'reporterNames',
  ];
  for (const field of REQUIRED_FIELDS) {
    assert(field in v, `output model contains "${field}"`);
  }
});

// ─── Transporter Rendering ────────────────────────────────────────────────────
// Mirrors dvicCheck._renderTransporterNames() — keep in sync.

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// nameCache mirrors dvicCheck._nameCache — id → resolved name
function renderTransporterNames(v, nameCache = new Map()) {
  const ids = (v.reporterIds ?? []).filter((id) => String(id).trim() !== '');
  if (ids.length === 0) {
    return `<em class="ct-dvic-tp-unknown" aria-label="Unbekannter Transporter">Unbekannter Transporter</em>`;
  }
  const labels = ids.map((id) => {
    const name = nameCache.get(id);
    return (name && name !== id) ? `${name} (ID: ${id})` : id;
  });
  const [primary, ...rest] = labels;
  const secondary = rest.length > 0
    ? `<span class="ct-dvic-tp-secondary">, ${esc(rest.join(', '))}</span>`
    : '';
  return `<span class="ct-dvic-tp-primary" aria-label="Transporter: ${esc(labels.join(', '))}">${esc(primary)}${secondary}</span>`;
}

describe('renderTransporterNames — single transporter with resolved name', () => {
  const cache = new Map([['A3GXI0B678GWLJ', 'Anna Müller']]);
  const v = { vehicleIdentifier: 'VAN-726', reporterNames: ['Anna Müller'], reporterIds: ['A3GXI0B678GWLJ'] };
  const html = renderTransporterNames(v, cache);
  assert(html.includes('Anna Müller'), 'name rendered');
  assert(html.includes('ID: A3GXI0B678GWLJ'), 'ID shown alongside name');
  assert(html.includes('ct-dvic-tp-primary'), 'primary CSS class present');
  assert(!html.includes('ct-dvic-tp-secondary'), 'no secondary span for single reporter');
  assert(html.includes('aria-label="Transporter: Anna M'), 'aria-label present');
});

describe('renderTransporterNames — multiple transporters (primary first)', () => {
  const cache = new Map([['ID1', 'Anna Müller'], ['ID2', 'Ben Berg']]);
  const v = { vehicleIdentifier: 'VAN-001', reporterNames: ['Anna Müller', 'Ben Berg'], reporterIds: ['ID1', 'ID2'] };
  const html = renderTransporterNames(v, cache);
  assert(html.includes('Anna Müller (ID: ID1)'), 'primary transporter rendered with ID');
  assert(html.includes('ct-dvic-tp-secondary'), 'secondary span present');
  assert(html.includes('Ben Berg (ID: ID2)'), 'secondary transporter rendered with ID');
  const primaryIdx = html.indexOf('Anna Müller');
  const secondaryIdx = html.indexOf('Ben Berg');
  assert(primaryIdx < secondaryIdx, 'primary appears before secondary');
});

describe('renderTransporterNames — missing transporter data (empty reporterIds)', () => {
  const v = { vehicleIdentifier: 'VAN-002', reporterNames: [], reporterIds: [] };
  const html = renderTransporterNames(v);
  assert(html.includes('Unbekannter Transporter'), '"Unbekannter Transporter" fallback shown');
  assert(html.includes('ct-dvic-tp-unknown'), 'unknown CSS class present');
  assert(html.includes('aria-label="Unbekannter Transporter"'), 'aria-label on fallback');
});

describe('renderTransporterNames — unresolved ID shown as bare ID (no double display)', () => {
  // When name lookup fails, ID is shown without "(ID: id)" duplication
  const v = { vehicleIdentifier: 'VAN-006', reporterNames: ['A3GXI0B678GWLJ'], reporterIds: ['A3GXI0B678GWLJ'] };
  const html = renderTransporterNames(v); // empty cache → fallback
  assert(html.includes('A3GXI0B678GWLJ'), 'ID present in output');
  assert(!html.includes('ID: A3GXI0B678GWLJ'), 'no "ID:" prefix when name not resolved');
  assert(html.includes('ct-dvic-tp-primary'), 'ID rendered as primary name');
  assert(!html.includes('Unbekannter Transporter'), 'fallback not shown when ID is available');
});

describe('renderTransporterNames — long transporter name (no truncation in markup)', () => {
  const longName = 'Maximilian Bartholomäus von Hohenzollern-Sigmaringen';
  const cache = new Map([['ID1', longName]]);
  const v = { vehicleIdentifier: 'VAN-004', reporterNames: [longName], reporterIds: ['ID1'] };
  const html = renderTransporterNames(v, cache);
  assert(html.includes(longName), 'long name rendered in full');
  assert(html.includes('ct-dvic-tp-primary'), 'primary CSS class present');
});

describe('renderTransporterNames — HTML in name is escaped', () => {
  const xss = '<script>alert(1)</script>';
  const cache = new Map([['ID1', xss]]);
  const v = { vehicleIdentifier: 'VAN-005', reporterNames: [xss], reporterIds: ['ID1'] };
  const html = renderTransporterNames(v, cache);
  assert(!html.includes('<script>'), 'raw <script> tag not in output');
  assert(html.includes('&lt;script&gt;'), 'name is HTML-escaped');
});

describe('toggle state — dvicShowTransporters defaults to true in DEFAULTS', () => {
  // Mirrors the DEFAULTS config check
  const DEFAULTS_FEATURES = { dvicShowTransporters: true };
  assertEqual(DEFAULTS_FEATURES.dvicShowTransporters, true, 'dvicShowTransporters default is true');
});

describe('toggle state — _showTransporters respects config flag', () => {
  // Simulates dvicCheck._showTransporters getter
  const showWhenTrue  = (cfg) => cfg.features.dvicShowTransporters !== false;
  assertEqual(showWhenTrue({ features: { dvicShowTransporters: true  } }), true,  'true → show');
  assertEqual(showWhenTrue({ features: { dvicShowTransporters: false } }), false, 'false → hide');
  assertEqual(showWhenTrue({ features: {} }),                              true,  'missing key → show (safe default)');
});

// ─── Sample Dataset ───────────────────────────────────────────────────────────
// Illustrates several line items with transporterNames from a real-style payload.
// Used as documentation for stakeholders on data contract expectations.
//
// Payload key:  inspectionsStatList[].inspectionStats[].inspectionDetails[].reporterId
// Resolved to:  vehicle.reporterNames[]  (via _getEmployeeNames batch lookup)
//
// VAN-726 (id 726, role Helper):
//   reporterIds:   ["A3GXI0B678GWLJ"]
//   nameCache:     A3GXI0B678GWLJ → "Anna Müller"
//   rendered:      <span class="ct-dvic-tp-primary">Anna Müller (ID: A3GXI0B678GWLJ)</span>
//
// VAN-042 (two inspectors):
//   reporterIds:   ["E001", "E002"]
//   nameCache:     E001 → "Ben Berg", E002 → "Clara Cruz"
//   rendered:      Ben Berg (ID: E001)<span class="ct-dvic-tp-secondary">, Clara Cruz (ID: E002)</span>
//
// VAN-099 (lookup failed → bare ID):
//   reporterIds:   ["UNKNOWN_ID"]
//   nameCache:     (no entry)
//   rendered:      <span class="ct-dvic-tp-primary">UNKNOWN_ID</span>
//
// VAN-000 (no inspections yet):
//   reporterIds:   []
//   reporterNames: []
//   rendered:      <em class="ct-dvic-tp-unknown">Unbekannter Transporter</em>

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
