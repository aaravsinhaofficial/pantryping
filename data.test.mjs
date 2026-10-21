import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePantry, getFreshness, filterCategories, STATUS_LABELS, createInventoryReview } from './data.mjs';

const NOW = Date.parse('2026-10-12T22:00:00.000Z');

test('preview, backup, and publication retain the actual review time', () => {
  const review = createInventoryReview();
  review.confirm(NOW);
  for (const delay of [0, 2 * 60_000, 14 * 60_000, 15 * 60_000]) {
    assert.equal(review.timestamp(NOW + delay), new Date(NOW).toISOString());
  }
  assert.throws(() => review.timestamp(NOW + 15 * 60_000 + 1), /expire after 15 minutes/);
  // Reading the timestamp does not silently renew the expired review.
  assert.throws(() => review.timestamp(NOW + 16 * 60_000), /check the confirmation box again/);
  review.confirm(NOW + 16 * 60_000);
  assert.equal(review.timestamp(NOW + 16 * 60_000), new Date(NOW + 16 * 60_000).toISOString());
});

test('edits and unreliable clocks require another explicit inventory review', () => {
  const review = createInventoryReview();
  assert.throws(() => review.timestamp(NOW), /Review every status/);
  review.confirm(NOW);
  review.invalidate();
  assert.throws(() => review.timestamp(NOW), /Review every status/);
  review.confirm(NOW);
  assert.throws(() => review.timestamp(NOW - 1), /Review every status/);
  review.confirm(NaN);
  assert.throws(() => review.timestamp(NOW), /Review every status/);
});
const fixture = () => ({
  schemaVersion: 1, isDemo: false, lastUpdatedAt: new Date(NOW).toISOString(), timeZone: 'America/Chicago',
  pantry: { name: 'Example pantry', location: 'Example town', address: '', phone: '', hours: [{ days: 'Monday', time: '10 am–noon' }], requirements: ['Bring a bag'], note: '' },
  categories: [
    { id: 'produce', name: 'Fresh produce', description: 'Vegetables and fruit', status: 'available' },
    { id: 'milk', name: 'Milk', description: 'Dairy', status: 'limited' },
    { id: 'rice', name: 'Rice', description: 'Dry goods', status: 'unavailable' },
    { id: 'formula', name: 'Formula', description: 'Infant supplies', status: 'unknown' },
  ],
});

test('validation returns a detached clone and preserves explicit unknown availability', () => {
  const source = fixture();
  const result = validatePantry(source);
  assert.deepEqual(result, source);
  result.categories[0].status = 'unknown';
  result.pantry.hours[0].days = 'Tuesday';
  assert.equal(source.categories[0].status, 'available');
  assert.equal(source.pantry.hours[0].days, 'Monday');
  assert.equal(result.categories[3].status, 'unknown');
  assert.equal(STATUS_LABELS.unknown, 'Not confirmed');
});

test('stock status must be explicit; malformed and inherited-key statuses are rejected', () => {
  for (const status of [undefined, null, '', 'Available', 'yes', '__proto__', 'toString']) {
    const source = fixture();
    source.categories[0].status = status;
    assert.throws(() => validatePantry(source), /status must be/);
  }
});

test('validation rejects malformed nested data, unsupported versions and types', () => {
  for (const value of [null, [], 'pantry', 42]) assert.throws(() => validatePantry(value), /must be an object/);
  const changes = [
    [data => { data.schemaVersion = 2; }, /schemaVersion/],
    [data => { data.isDemo = 'false'; }, /isDemo/],
    [data => { delete data.lastUpdatedAt; }, /lastUpdatedAt/],
    [data => { data.timeZone = 'Mars/Olympus'; }, /timezone/],
    [data => { data.pantry.name = ' '; }, /cannot be empty/],
    [data => { data.pantry.address = 123; }, /must be text/],
    [data => { data.pantry.hours = {}; }, /must be a list/],
    [data => { data.pantry.hours = [null]; }, /must be an object/],
    [data => { data.pantry.requirements = ['']; }, /cannot be empty/],
    [data => { data.categories = [null]; }, /must be an object/],
  ];
  for (const [change, pattern] of changes) {
    const source = fixture(); change(source);
    assert.throws(() => validatePantry(source), pattern);
  }
});

test('timestamps must be actual ISO calendar dates with an explicit timezone', () => {
  for (const lastUpdatedAt of ['2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z', '2026-10-12', '2026-10-12T12:00:00', 'today', '', 0, '2026-10-12T24:00:00Z']) {
    assert.throws(() => validatePantry({ ...fixture(), lastUpdatedAt }), /lastUpdatedAt/);
  }
  for (const lastUpdatedAt of [null, '2024-02-29T12:00:00Z', '2026-10-12T17:00:00-05:00']) {
    assert.equal(validatePantry({ ...fixture(), lastUpdatedAt }).lastUpdatedAt, lastUpdatedAt);
  }
});

test('category counts, IDs and field lengths are bounded', () => {
  const data = fixture();
  data.categories = Array.from({ length: 40 }, (_, index) => ({ ...data.categories[0], id: `item-${index}` }));
  assert.equal(validatePantry(data).categories.length, 40);
  data.categories.push({ ...data.categories[0], id: 'extra' });
  assert.throws(() => validatePantry(data), /at most 40/);
  const duplicate = fixture(); duplicate.categories[1].id = duplicate.categories[0].id;
  assert.throws(() => validatePantry(duplicate), /duplicated/);
  const badId = fixture(); badId.categories[0].id = '../produce';
  assert.throws(() => validatePantry(badId), /id must contain/);
  const tooLong = fixture(); tooLong.categories[0].name = 'x'.repeat(81);
  assert.throws(() => validatePantry(tooLong), /80 characters/);
});

test('demo takes priority and is explicitly fictional even with a recent date', () => {
  const result = getFreshness({ ...fixture(), isDemo: true }, NOW);
  assert.equal(result.kind, 'demo');
  assert.match(result.detail, /fictional/);
  assert.match(result.detail, /not a live food resource/);
});

test('freshness changes strictly after 24 hours, and supplies a confirmation timestamp', () => {
  const data = fixture();
  assert.equal(getFreshness(data, NOW).kind, 'fresh');
  assert.equal(getFreshness(data, NOW + 86_400_000).kind, 'fresh');
  const stale = getFreshness(data, NOW + 86_400_001);
  assert.equal(stale.kind, 'stale');
  assert.match(stale.detail, /Last confirmed/);
  assert.match(stale.detail, /Availability may have changed/);
  assert.match(stale.detail, /America\/Chicago/);
});

test('unconfirmed and unreliable future timestamps never show as fresh', () => {
  for (const lastUpdatedAt of [null, undefined, 'bad', '2026-02-30T12:00:00Z', new Date(NOW + 300_001).toISOString()]) {
    assert.equal(getFreshness({ ...fixture(), lastUpdatedAt }, NOW).kind, 'unknown');
  }
  assert.equal(getFreshness({ ...fixture(), lastUpdatedAt: new Date(NOW + 300_000).toISOString() }, NOW).kind, 'fresh');
  assert.equal(getFreshness(fixture(), NaN).kind, 'unknown');
  assert.equal(getFreshness({ ...fixture(), timeZone: 'invalid' }, NOW).kind, 'unknown');
});

test('search covers descriptions, ignores case/outer whitespace and combines with stock filter', () => {
  const categories = fixture().categories;
  assert.deepEqual(filterCategories(categories, ' FRUIT ').map(item => item.id), ['produce']);
  assert.deepEqual(filterCategories(categories, 'dairy', true).map(item => item.id), ['milk']);
  assert.deepEqual(filterCategories(categories, '', true).map(item => item.id), ['produce', 'milk']);
  assert.deepEqual(filterCategories(categories, 'infant', true), []);
  assert.equal(filterCategories(categories, '').length, 4);
  assert.equal(categories.length, 4);
});
