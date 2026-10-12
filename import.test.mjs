import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInventoryCSV, inventoryCSVTemplate } from './import.mjs';

const categories = [
  { id: 'produce', name: 'Fresh produce', status: 'available' },
  { id: 'grains', name: 'Rice, pasta & grains', status: 'limited' },
  { id: 'baby', name: 'Baby "essentials"', status: 'unavailable' },
];

test('matches names and IDs, ignores case and whitespace, and leaves omitted categories unknown', () => {
  const output = parseInventoryCSV('category,status\n FRESH PRODUCE , In stock\nBABY,Out of stock', categories);
  assert.deepEqual(output, [
    { id: 'produce', status: 'available', evidence: 'CSV row 2' },
    { id: 'grains', status: 'unknown' },
    { id: 'baby', status: 'unavailable', evidence: 'CSV row 3' },
  ]);
  assert.equal(categories[1].status, 'limited');
});

test('accepts BOM, CRLF, quoted commas, escaped quotes, reordered headers and empty rows', () => {
  const csv = '\uFEFFSTATUS,CATEGORY\r\n\r\nLimited,"Rice, pasta & grains"\r\nNot confirmed,"Baby ""essentials"""\r\n,,\r\n';
  const output = parseInventoryCSV(csv, categories);
  assert.equal(output[1].status, 'limited');
  assert.equal(output[1].evidence, 'CSV row 3');
  assert.equal(output[2].status, 'unknown');
});

test('quoted multiline category names and line accounting survive parsing', () => {
  const custom = [...categories, { id: 'special', name: 'Special\nsupplies' }];
  const output = parseInventoryCSV('category,status\n"Special\r\nsupplies",available\r\nbaby,limited', custom);
  assert.equal(output[3].status, 'available');
  assert.equal(output[3].evidence, 'CSV row 2');
  assert.equal(output[2].evidence, 'CSV row 4');
});

test('all documented status aliases normalize correctly', () => {
  for (const [input, expected] of [
    ['available', 'available'], ['In stock', 'available'], ['LIMITED', 'limited'],
    ['unavailable', 'unavailable'], ['Out of stock', 'unavailable'],
    ['unknown', 'unknown'], ['Not confirmed', 'unknown'],
  ]) assert.equal(parseInventoryCSV(`category,status\nproduce,${input}`, categories)[0].status, expected);
});

test('rejects malformed quoting instead of guessing', () => {
  for (const csv of [
    'category,status\n"produce,available',
    'category,status\npro"duce,available',
    'category,status\n"produce"junk,available',
    'category,status\nproduce,"available""',
  ]) assert.throws(() => parseInventoryCSV(csv, categories), /quot/);
});

test('requires precise headers and at least one nonempty inventory row', () => {
  for (const csv of ['', '\n\r\n', 'category,status', 'category,status\n,,\n , ', 'Category,CATEGORY\nproduce,available', 'category,quantity\nproduce,3', 'category,status,extra\nproduce,available,x']) {
    assert.throws(() => parseInventoryCSV(csv, categories), /empty|at least one|duplicate|two columns/);
  }
});

test('rejects unknown categories, missing or unsupported statuses, malformed rows and duplicates via aliases', () => {
  const checks = [
    ['category,status\nbeef,available', /unknown category/],
    ['category,status\nproduce,', /unknown status/],
    ['category,status\nproduce,plenty', /unknown status/],
    ['category,status\nproduce', /exactly two fields/],
    ['category,status\nproduce,available,x', /exactly two fields/],
    ['category,status\nproduce,available\nFresh produce,limited', /more than once/],
  ];
  for (const [csv, pattern] of checks) assert.throws(() => parseInventoryCSV(csv, categories), pattern);
});

test('guards file byte size and category row limits', () => {
  assert.throws(() => parseInventoryCSV('é'.repeat(50_001), categories), /100 KB/);
  assert.throws(() => parseInventoryCSV('category,status\n' + 'produce,unknown\n'.repeat(41), categories), /at most 40/);
  const forty = Array.from({ length: 40 }, (_, i) => ({ id: `cat-${i}`, name: `Category ${i}` }));
  assert.equal(parseInventoryCSV(inventoryCSVTemplate(forty), forty).length, 40);
});

test('ambiguous names do not silently select a category; unique IDs work', () => {
  const ambiguous = [{ id: 'one', name: 'Food' }, { id: 'two', name: 'Food' }];
  assert.throws(() => parseInventoryCSV('category,status\nFood,available', ambiguous), /ambiguous/);
  assert.equal(parseInventoryCSV('category,status\none,available', ambiguous)[0].status, 'available');
});

test('template is an importable unconfirmed checklist with no metadata or carried stock', () => {
  const template = inventoryCSVTemplate(categories);
  assert.equal(template, 'category,status\r\nproduce,Not confirmed\r\ngrains,Not confirmed\r\nbaby,Not confirmed\r\n');
  const output = parseInventoryCSV(template, categories);
  assert.deepEqual(output.map(item => item.status), ['unknown', 'unknown', 'unknown']);
  assert(output.every(item => !('lastUpdatedAt' in item) && !('name' in item)));
});
