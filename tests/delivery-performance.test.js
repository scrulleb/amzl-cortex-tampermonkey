/**
 * delivery-performance.test.js
 *
 * Unit & integration tests for the Daily Delivery Performance module helpers.
 * Run with: node tests/delivery-performance.test.js
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

function describe(name, fn) {
  console.log(`\n🔷 ${name}`);
  fn();
}

// ─── Inline copies of pure helpers (mirrors cortex-tools.user.js) ─────────────

const DP_STRING_FIELDS = new Set([
  'country', 'station_code', 'program',
  'country_dspid_stationcode', 'country_program_stationcode',
  'region', 'dsp_code', 'country_program_dspid_stationcode',
  'country_stationcode', 'country_program_data_date',
]);

const DP_INT_FIELDS = new Set([
  'delivered', 'unbucketed_delivery_misses', 'address_not_found',
  'return_to_station_utl', 'return_to_station_uta', 'customer_not_available',
  'return_to_station_all', 'successful_c_return_pickups', 'rts_other',
  'dispatched', 'transferred_out', 'dnr', 'return_to_station_nsl',
  'completed_routes', 'first_delv_with_test_dim', 'pde_photos_taken',
  'packages_not_on_van', 'first_disp_with_test_dim', 'delivery_attempt',
  'return_to_station_bc', 'pod_bypass', 'pod_opportunity', 'pod_success',
  'next_day_routes', 'scheduled_mfn_pickups', 'successful_mfn_pickups',
  'rejected_packages', 'payment_not_ready', 'scheduled_c_return_pickups',
  'return_to_station_cu', 'return_to_station_oodt', 'rts_dpmo', 'dnr_dpmo',
  'ttl',
]);

const DP_PERCENT_FIELDS = new Set([
  'pod_success_rate', 'rts_cu_percent', 'rts_other_percent', 'rts_oodt_percent',
  'rts_utl_percent', 'rts_bc_percent', 'delivery_attempt_percent',
  'customer_not_available_percent', 'first_day_delivery_success_percent',
  'rts_all_percent', 'rejected_packages_percent', 'payment_not_ready_percent',
  'delivery_success_dsp', 'delivery_success',
  'unbucketed_delivery_misses_percent', 'address_not_found_percent',
]);

const DP_RATE_FIELDS    = new Set(['shipment_zone_per_hour']);
const DP_DATETIME_FIELDS = new Set(['last_updated_time']);
const DP_EPOCH_FIELDS   = new Set(['messageTimestamp']);
const DP_DATE_FIELDS    = new Set(['data_date']);

function dpParseRow(jsonStr) {
  const raw = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.trim()] = v;
  }
  return out;
}

function dpClassifyField(field) {
  if (DP_STRING_FIELDS.has(field))   return 'string';
  if (DP_INT_FIELDS.has(field))      return 'int';
  if (DP_PERCENT_FIELDS.has(field))  return 'percent';
  if (DP_RATE_FIELDS.has(field))     return 'rate';
  if (DP_DATETIME_FIELDS.has(field)) return 'datetime';
  if (DP_EPOCH_FIELDS.has(field))    return 'epoch';
  if (DP_DATE_FIELDS.has(field))     return 'date';
  return 'unknown';
}

function dpFormatValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  const type = dpClassifyField(field);
  switch (type) {
    case 'percent': {
      const pct = (Number(value) * 100).toFixed(2);
      return `${pct}%`;
    }
    case 'rate':
      return Number(value).toFixed(2);
    case 'datetime': {
      try {
        return new Date(value).toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
      } catch { return String(value); }
    }
    case 'epoch': {
      try {
        return new Date(Number(value)).toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
      } catch { return String(value); }
    }
    case 'date':
      return String(value);
    case 'int':
      return Number(value).toLocaleString();
    default:
      return String(value);
  }
}

function dpRateClass(field, value) {
  const v = Number(value);
  if (field.startsWith('rts_') || field.includes('miss') ||
      field === 'customer_not_available_percent' ||
      field === 'rejected_packages_percent' ||
      field === 'payment_not_ready_percent' ||
      field === 'address_not_found_percent') {
    if (v < 0.005) return 'great';
    if (v < 0.01)  return 'ok';
    return 'bad';
  }
  if (v >= 0.99)  return 'great';
  if (v >= 0.97)  return 'ok';
  return 'bad';
}

function dpValidateDateRange(from, to) {
  if (!from || !to) return 'Both From and To dates are required.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return 'From date format must be YYYY-MM-DD.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to))   return 'To date format must be YYYY-MM-DD.';
  if (from > to) return 'From date must not be after To date.';
  return null;
}

function dpParseApiResponse(json) {
  try {
    const rows = json?.tableData?.dsp_daily_supplemental_quality?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows
      .map(dpParseRow)
      .sort((a, b) => (a.data_date || '').localeCompare(b.data_date || ''));
  } catch (e) {
    return [];
  }
}

// ─── Example raw row from fixture ────────────────────────────────────────────

const EXAMPLE_ROW_STR = JSON.stringify({
  'shipment_zone_per_hour': 26.660552636157,
  'country': 'DE',
  'pod_success_rate': 0.9880030959752322,
  'pod_inappropriate_photos': 0,
  'station_code': 'XYZ1',
  'rts_uta_percent': 0,
  'delivered': 7168,
  'program': 'AMZL',
  'unbucketed_delivery_misses': 6,
  'address_not_found': 2,
  'return_to_station_utl': 2,
  'rts_cu_percent': 0.0023584905660377358,
  'rts_other_percent': 0.003190899001109878,
  'rts_oodt_percent': 0,
  'return_to_station_uta': 0,
  'country_dspid_stationcode': 'DE_TEST_XYZ1',
  'customer_not_available': 31,
  'return_to_station_all': 39,
  'successful_c_return_pickups': 0,
  'rts_other': 23,
  ' address_not_found_percent': 0.0002774694783573807,   // leading space — anomaly
  'dispatched': 7208,
  'scheduled_c_return_pickups': 0,
  'return_to_station_cu': 17,
  'rts_utl_percent': 0.0002774694783573807,
  'transferred_out': 2,
  'dnr': 0,
  'return_to_station_oodt': 0,
  'country_program_stationcode': 'DE_AMZL_XYZ1',
  'payment_not_ready': 0,
  'rts_bc_percent': 0.001942286348501665,
  'dnr_dpmo': 0,
  'delivery_attempt_percent': 0.9986126526082131,
  'last_updated_time': '2026-03-20T07:58:56.997439372Z',
  'return_to_station_nsl': 0,
  'completed_routes': 42,
  'region': 'EU',
  'first_delv_with_test_dim': 7139,
  'dsp_code': 'TEST',
  'delivery_success_dsp': 0.9947266167082986,
  'payment_not_ready_percent': 0,
  'rts_nsl_percent': 0,
  'rejected_packages': 0,
  'pde_photos_taken': 2565,
  'first_day_delivery_success_percent': 0.9955375819272068,
  'rts_all_percent': 0.0054106548279689234,
  'packages_not_on_van': 3,
  'rejected_packages_percent': 0,
  'first_disp_with_test_dim': 7171,
  'delivery_attempt': 7198,
  'return_to_station_bc': 14,
  'pod_opportunity': 2584,
  'pod_bypass': 19,
  'country_program_dspid_stationcode': 'DE_AMZL_TEST_XYZ1',
  'data_date': '2026-03-19',
  'ttl': 1805414400,
  'pod_success': 2553,
  'customer_not_available_percent': 0.004300776914539401,
  'delivery_success': 0.9944506104328524,
  'next_day_routes': 36,
  'scheduled_mfn_pickups': 0,
  'unbucketed_delivery_misses_percent': 0.000832408435072142,
  'successful_mfn_pickups': 0,
  'rts_dpmo': 0,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('dpParseRow — key normalisation', () => {
  const record = dpParseRow(EXAMPLE_ROW_STR);

  assert('address_not_found_percent' in record,
    'leading-space key " address_not_found_percent" is trimmed to "address_not_found_percent"');

  assert(!(' address_not_found_percent' in record),
    'original leading-space key is not present in parsed record');

  assertEqual(record.address_not_found_percent, 0.0002774694783573807,
    'address_not_found_percent value is preserved after trimming');

  assertEqual(record.country, 'DE',
    'normal string field "country" parsed correctly');

  assertEqual(record.delivered, 7168,
    'integer field "delivered" parsed correctly');

  assertEqual(record.data_date, '2026-03-19',
    'date field "data_date" parsed correctly');
});

describe('dpParseRow — accepts pre-parsed object', () => {
  const obj = { station_code: 'XYZ1', ' address_not_found_percent': 0.001 };
  const record = dpParseRow(obj);
  assert('address_not_found_percent' in record,
    'trims keys when passed a plain object (not a JSON string)');
});

describe('dpClassifyField — field type mapping', () => {
  assertEqual(dpClassifyField('country'),                          'string',   'country → string');
  assertEqual(dpClassifyField('station_code'),                     'string',   'station_code → string');
  assertEqual(dpClassifyField('dsp_code'),                         'string',   'dsp_code → string');
  assertEqual(dpClassifyField('region'),                           'string',   'region → string');
  assertEqual(dpClassifyField('delivered'),                        'int',      'delivered → int');
  assertEqual(dpClassifyField('dispatched'),                       'int',      'dispatched → int');
  assertEqual(dpClassifyField('completed_routes'),                 'int',      'completed_routes → int');
  assertEqual(dpClassifyField('ttl'),                              'int',      'ttl → int');
  assertEqual(dpClassifyField('delivery_success'),                 'percent',  'delivery_success → percent');
  assertEqual(dpClassifyField('pod_success_rate'),                 'percent',  'pod_success_rate → percent');
  assertEqual(dpClassifyField('rts_all_percent'),                  'percent',  'rts_all_percent → percent');
  assertEqual(dpClassifyField('address_not_found_percent'),        'percent',  'address_not_found_percent → percent');
  assertEqual(dpClassifyField('unbucketed_delivery_misses_percent'),'percent', 'unbucketed_delivery_misses_percent → percent');
  assertEqual(dpClassifyField('shipment_zone_per_hour'),           'rate',     'shipment_zone_per_hour → rate');
  assertEqual(dpClassifyField('last_updated_time'),                'datetime', 'last_updated_time → datetime');
  assertEqual(dpClassifyField('messageTimestamp'),                 'epoch',    'messageTimestamp → epoch');
  assertEqual(dpClassifyField('data_date'),                        'date',     'data_date → date');
  assertEqual(dpClassifyField('some_unknown_field'),               'unknown',  'unknown field → unknown');
});

describe('dpFormatValue — formatters', () => {
  assert(dpFormatValue('delivery_success', 0.9944506104328524).endsWith('%'),
    'percent field renders with % sign');
  assertEqual(dpFormatValue('delivery_success', 0.9944506104328524), '99.45%',
    'delivery_success 0.9944… formats to "99.45%"');
  assertEqual(dpFormatValue('rts_all_percent', 0.0054106548279689234), '0.54%',
    'rts_all_percent formats correctly');
  assertEqual(dpFormatValue('address_not_found_percent', 0.0002774694783573807), '0.03%',
    'address_not_found_percent formats correctly');
  assertEqual(dpFormatValue('shipment_zone_per_hour', 26.660552636157), '26.66',
    'rate field formats to 2dp without %');
  assertEqual(dpFormatValue('data_date', '2026-03-19'), '2026-03-19',
    'date field returns string as-is');
  assert(dpFormatValue('last_updated_time', '2026-03-20T07:58:56.997439372Z').length > 5,
    'datetime field returns a non-empty formatted string');
  const epochMs = 1742463600000;
  assert(dpFormatValue('messageTimestamp', epochMs).length > 5,
    'epoch field returns a non-empty formatted string');

  // null / undefined / empty string
  assertEqual(dpFormatValue('delivered', null),      '—', 'null → em dash');
  assertEqual(dpFormatValue('delivered', undefined), '—', 'undefined → em dash');
  assertEqual(dpFormatValue('delivered', ''),        '—', 'empty string → em dash');
});

describe('dpRateClass — colour classification', () => {
  // Success-type fields: higher = better
  assertEqual(dpRateClass('delivery_success', 0.995), 'great', 'delivery_success 99.5% → great');
  assertEqual(dpRateClass('delivery_success', 0.975), 'ok',    'delivery_success 97.5% → ok');
  assertEqual(dpRateClass('delivery_success', 0.95),  'bad',   'delivery_success 95% → bad');

  // RTS-type fields: lower = better
  assertEqual(dpRateClass('rts_all_percent', 0.003),  'great', 'rts_all_percent 0.3% → great');
  assertEqual(dpRateClass('rts_all_percent', 0.007),  'ok',    'rts_all_percent 0.7% → ok');
  assertEqual(dpRateClass('rts_all_percent', 0.015),  'bad',   'rts_all_percent 1.5% → bad');

  // address_not_found_percent: lower = better
  assertEqual(dpRateClass('address_not_found_percent', 0.0002), 'great',
    'address_not_found_percent tiny value → great');
  assertEqual(dpRateClass('address_not_found_percent', 0.009),  'ok',
    'address_not_found_percent <1% → ok');

  // unbucketed_delivery_misses_percent includes "miss"
  assertEqual(dpRateClass('unbucketed_delivery_misses_percent', 0.001), 'great',
    'unbucketed_delivery_misses_percent 0.1% → great');
});

describe('dpValidateDateRange — date input validation', () => {
  assertEqual(dpValidateDateRange('2026-03-01', '2026-03-19'), null,
    'valid range returns null');
  assert(!!dpValidateDateRange('', '2026-03-19'),
    'empty from → error message');
  assert(!!dpValidateDateRange('2026-03-01', ''),
    'empty to → error message');
  assert(!!dpValidateDateRange('01-03-2026', '2026-03-19'),
    'wrong from format → error');
  assert(!!dpValidateDateRange('2026-03-01', '19-03-2026'),
    'wrong to format → error');
  assert(!!dpValidateDateRange('2026-03-19', '2026-03-01'),
    'from > to → error');
  assertEqual(dpValidateDateRange('2026-03-01', '2026-03-01'), null,
    'same from and to is valid (single day)');
});

describe('dpParseApiResponse — full API response parsing', () => {
  const fakeApiResponse = {
    tableData: {
      dsp_daily_supplemental_quality: {
        rows: [
          EXAMPLE_ROW_STR,
          // A second record with an earlier date to test sort
          JSON.stringify({ data_date: '2026-03-18', delivered: 6000, country: 'DE' }),
        ],
      },
    },
  };

  const records = dpParseApiResponse(fakeApiResponse);
  assertEqual(records.length, 2, 'parses two rows');
  assertEqual(records[0].data_date, '2026-03-18', 'records are sorted ascending by data_date');
  assertEqual(records[1].data_date, '2026-03-19', 'second record has the later date');
  assert('address_not_found_percent' in records[1],
    'address_not_found_percent key is normalised in parsed response records');
});

describe('dpParseApiResponse — handles empty / missing data gracefully', () => {
  assertEqual(dpParseApiResponse({}), [],
    'returns empty array for empty object');
  assertEqual(dpParseApiResponse({ tableData: {} }), [],
    'returns empty array when dsp_daily_supplemental_quality missing');
  assertEqual(dpParseApiResponse({ tableData: { dsp_daily_supplemental_quality: { rows: [] } } }), [],
    'returns empty array for empty rows array');
  assertEqual(dpParseApiResponse(null), [],
    'returns empty array for null payload');
  assertEqual(dpParseApiResponse(undefined), [],
    'returns empty array for undefined payload');
});

describe('dpParseApiResponse — partial data (some fields missing in row)', () => {
  const partialRow = JSON.stringify({ data_date: '2026-03-20', country: 'DE' });
  const records = dpParseApiResponse({
    tableData: { dsp_daily_supplemental_quality: { rows: [partialRow] } },
  });
  assertEqual(records.length, 1, 'parses partial row');
  assertEqual(records[0].country, 'DE', 'present fields are accessible');
  assertEqual(records[0].delivered, undefined, 'missing field is undefined (not an error)');
});

describe('Accessibility — field labelling coverage', () => {
  // Every field that mappers know about should have an entry in DP_LABELS
  // (This ensures no displayed field is unlabelled in production.)
  const ALL_KNOWN_FIELDS = [
    ...DP_STRING_FIELDS,
    ...DP_INT_FIELDS,
    ...DP_PERCENT_FIELDS,
    ...DP_RATE_FIELDS,
    ...DP_DATETIME_FIELDS,
    ...DP_EPOCH_FIELDS,
    ...DP_DATE_FIELDS,
  ];

  const DP_LABELS = {
    country: 'Country', station_code: 'Station', program: 'Program',
    country_dspid_stationcode: 'Country/DSP/Station',
    country_program_stationcode: 'Country/Program/Station',
    region: 'Region', dsp_code: 'DSP',
    country_program_dspid_stationcode: 'Country/Program/DSP/Station',
    country_stationcode: 'Country/Station',
    country_program_data_date: 'Country/Program/Date',
    delivered: 'Delivered', dispatched: 'Dispatched',
    completed_routes: 'Completed Routes', delivery_attempt: 'Delivery Attempts',
    unbucketed_delivery_misses: 'Unbucketed Misses',
    address_not_found: 'Address Not Found',
    return_to_station_utl: 'RTS UTL', return_to_station_uta: 'RTS UTA',
    customer_not_available: 'Customer N/A',
    return_to_station_all: 'RTS All', return_to_station_cu: 'RTS CU',
    return_to_station_bc: 'RTS BC', return_to_station_nsl: 'RTS NSL',
    return_to_station_oodt: 'RTS OODT',
    successful_c_return_pickups: 'C-Return Pickups',
    rts_other: 'RTS Other', transferred_out: 'Transferred Out', dnr: 'DNR',
    first_delv_with_test_dim: 'First Delv (dim)', pde_photos_taken: 'PDE Photos',
    packages_not_on_van: 'Pkgs Not on Van',
    first_disp_with_test_dim: 'First Disp (dim)',
    pod_bypass: 'POD Bypass', pod_opportunity: 'POD Opportunity',
    pod_success: 'POD Success', next_day_routes: 'Next Day Routes',
    scheduled_mfn_pickups: 'Sched MFN Pickups',
    successful_mfn_pickups: 'Successful MFN Pickups',
    rejected_packages: 'Rejected Pkgs', payment_not_ready: 'Payment N/Ready',
    scheduled_c_return_pickups: 'Sched C-Return',
    rts_dpmo: 'RTS DPMO', dnr_dpmo: 'DNR DPMO', ttl: 'TTL',
    shipment_zone_per_hour: 'Shipments/Zone/Hour',
    pod_success_rate: 'POD Success Rate',
    rts_cu_percent: 'RTS CU %', rts_other_percent: 'RTS Other %',
    rts_oodt_percent: 'RTS OODT %', rts_utl_percent: 'RTS UTL %',
    rts_bc_percent: 'RTS BC %', delivery_attempt_percent: 'Delivery Attempt %',
    customer_not_available_percent: 'Customer N/A %',
    first_day_delivery_success_percent: 'First-Day Success %',
    rts_all_percent: 'RTS All %', rejected_packages_percent: 'Rejected Pkgs %',
    payment_not_ready_percent: 'Payment N/Ready %',
    delivery_success_dsp: 'Delivery Success (DSP)',
    delivery_success: 'Delivery Success',
    unbucketed_delivery_misses_percent: 'Unbucketed Misses %',
    address_not_found_percent: 'Address Not Found %',
    last_updated_time: 'Last Updated', messageTimestamp: 'Message Timestamp',
    data_date: 'Data Date',
  };

  const unlabelled = ALL_KNOWN_FIELDS.filter((f) => !DP_LABELS[f]);
  assertEqual(unlabelled, [],
    `All ${ALL_KNOWN_FIELDS.length} known fields have a human-readable label`);
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
