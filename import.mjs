/** Import an inventory check without changing pantry details or confirmation metadata. */
const MAX_BYTES = 100_000;
const STATUS_ALIASES = new Map([
  ['available', 'available'], ['in stock', 'available'],
  ['limited', 'limited'],
  ['unavailable', 'unavailable'], ['out of stock', 'unavailable'],
  ['unknown', 'unknown'], ['not confirmed', 'unknown'],
]);
const normalize = value => value.trim().toLocaleLowerCase('en-US');

function csvRows(text) {
  const rows = [];
  let cells = [];
  let cell = '';
  let mode = 'start';
  let line = 1;
  let rowLine = 1;
  const finishCell = () => { cells.push(cell); cell = ''; mode = 'start'; };
  const finishRow = () => {
    finishCell();
    if (cells.some(value => value.trim() !== '')) rows.push({ cells, line: rowLine });
    cells = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const isNewline = char === '\n' || char === '\r';
    if (mode === 'quoted') {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; }
        else mode = 'closed';
      } else if (isNewline) {
        cell += '\n';
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        line += 1;
      } else cell += char;
      continue;
    }
    if (char === ',') { finishCell(); continue; }
    if (isNewline) {
      finishRow();
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      line += 1;
      rowLine = line;
      continue;
    }
    if (mode === 'closed') {
      // Whitespace after a closing quote is harmless; other characters are malformed.
      if (char === ' ' || char === '\t') continue;
      throw new Error(`CSV row ${line}: unexpected text after a closing quote.`);
    }
    if (char === '"') {
      if (mode !== 'start') throw new Error(`CSV row ${line}: a quote inside an unquoted field must be escaped inside a quoted field.`);
      mode = 'quoted';
      continue;
    }
    cell += char;
    mode = 'plain';
  }
  if (mode === 'quoted') throw new Error(`CSV row ${rowLine}: a quoted field is missing its closing quote.`);
  finishRow();
  return rows;
}

function categoryIndex(categories) {
  if (!Array.isArray(categories) || categories.length > 40) {
    throw new Error('The board must provide a list of at most 40 categories.');
  }
  const lookup = new Map();
  const ids = new Set();
  for (const category of categories) {
    if (!category || typeof category.id !== 'string' || !category.id.trim() || typeof category.name !== 'string' || !category.name.trim()) {
      throw new Error('Every board category must have a nonempty id and name.');
    }
    const id = normalize(category.id);
    if (ids.has(id)) throw new Error(`The board has a duplicate category id: ${category.id}.`);
    ids.add(id);
    for (const key of new Set([id, normalize(category.name)])) {
      const matches = lookup.get(key) || [];
      matches.push(category.id);
      lookup.set(key, matches);
    }
  }
  return lookup;
}

/**
 * CSV headers: category,status (either order, case-insensitive).
 * Category: an exact existing ID or name, ignoring case and surrounding whitespace.
 * Status: available / In stock, limited, unavailable / Out of stock,
 * or unknown / Not confirmed. Omitted categories become unknown.
 * Each imported entry includes a row reference; metadata is deliberately untouched.
 */
export function parseInventoryCSV(text, categories) {
  if (typeof text !== 'string') throw new Error('CSV content must be text.');
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('CSV files must be 100 KB or smaller.');
  const lookup = categoryIndex(categories);
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  if (!rows.length) throw new Error('The CSV is empty. Add a category,status header and at least one category row.');
  const headers = rows[0].cells.map(normalize);
  if (new Set(headers).size !== headers.length) throw new Error('The CSV has duplicate column names. Use each of category and status once.');
  if (headers.length !== 2 || !headers.includes('category') || !headers.includes('status')) {
    throw new Error('The CSV must have exactly two columns named category and status.');
  }
  const entries = rows.slice(1);
  if (!entries.length) throw new Error('The CSV needs at least one category row after the header.');
  if (entries.length > 40) throw new Error('The CSV can contain at most 40 category rows.');
  const categoryColumn = headers.indexOf('category');
  const statusColumn = headers.indexOf('status');
  const imported = new Map();
  for (const row of entries) {
    if (row.cells.length !== 2) throw new Error(`CSV row ${row.line}: expected exactly two fields. Put text containing commas inside double quotes.`);
    const categoryText = row.cells[categoryColumn].trim();
    const matches = lookup.get(normalize(categoryText));
    if (!matches) throw new Error(`CSV row ${row.line}: unknown category "${categoryText}". Use an existing category ID or exact name.`);
    if (matches.length !== 1) throw new Error(`CSV row ${row.line}: category "${categoryText}" is ambiguous. Use a unique category ID.`);
    const id = matches[0];
    if (imported.has(id)) throw new Error(`CSV row ${row.line}: category "${categoryText}" appears more than once.`);
    const statusText = row.cells[statusColumn].trim();
    const status = STATUS_ALIASES.get(normalize(statusText));
    if (!status) throw new Error(`CSV row ${row.line}: unknown status "${statusText}". Use Available (or In stock), Limited, Unavailable (or Out of stock), or Not confirmed (or unknown).`);
    imported.set(id, { id, status, evidence: `CSV row ${row.line}` });
  }
  return categories.map(category => imported.get(category.id) || { id: category.id, status: 'unknown' });
}

const quoteCSV = value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** A conservative starter sheet: every category starts explicitly unconfirmed. */
export function inventoryCSVTemplate(categories) {
  categoryIndex(categories);
  return ['category,status', ...categories.map(category => `${quoteCSV(category.id)},Not confirmed`)].join('\r\n') + '\r\n';
}
