/** Data validation and honest freshness labels for a static pantry page. */
export const STATUS_LABELS = Object.freeze({
  available: 'Available',
  limited: 'Limited',
  unavailable: 'Unavailable',
  unknown: 'Not confirmed',
});

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** Keep the time of the actual staff review; later actions must not renew it. */
export function createInventoryReview() {
  let confirmedAt = null;
  return {
    confirm(now = Date.now()) { confirmedAt = Number.isFinite(now) ? now : null; },
    invalidate() { confirmedAt = null; },
    timestamp(now = Date.now()) {
      if (confirmedAt === null || !Number.isFinite(now) || now < confirmedAt
          || now - confirmedAt > 15 * 60 * 1000) {
        confirmedAt = null;
        throw new Error('Review every status and check the confirmation box again. Reviews expire after 15 minutes.');
      }
      return new Date(confirmedAt).toISOString();
    },
  };
}

function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function string(value, path, maxLength, allowEmpty = false) {
  if (typeof value !== 'string') throw new Error(`${path} must be text.`);
  const result = value.trim();
  if (!allowEmpty && !result) throw new Error(`${path} cannot be empty.`);
  if (result.length > maxLength) {
    throw new Error(`${path} must be ${maxLength} characters or fewer.`);
  }
  return result;
}

function list(value, path, maximum) {
  if (!Array.isArray(value)) throw new Error(`${path} must be a list.`);
  if (value.length > maximum) throw new Error(`${path} can contain at most ${maximum} items.`);
  return value;
}

// Require a timezone and actual calendar date; Date.parse alone accepts February 30.
function parseTimestamp(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || hour > 23 || minute > 59 || second > 59) return NaN;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return NaN;
  return Date.parse(value);
}

function timezone(value) {
  const result = string(value, 'timeZone', 100);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: result }).format(0);
  } catch {
    throw new Error('timeZone must be a valid timezone, such as America/Chicago.');
  }
  return result;
}

/** Validate all required fields, returning an independent, plain-data clone. */
export function validatePantry(value) {
  const data = record(value, 'Pantry data');
  if (data.schemaVersion !== 1) throw new Error('schemaVersion must be 1.');
  if (typeof data.isDemo !== 'boolean') throw new Error('isDemo must be true or false.');
  if (data.lastUpdatedAt !== null && !Number.isFinite(parseTimestamp(data.lastUpdatedAt))) {
    throw new Error('lastUpdatedAt must be null or a valid ISO timestamp with a timezone.');
  }
  const timeZone = timezone(data.timeZone);
  const pantry = record(data.pantry, 'pantry');
  const categories = list(data.categories, 'categories', 40);
  const ids = new Set();
  const checkedCategories = categories.map((item, index) => {
    const path = `categories[${index}]`;
    record(item, path);
    const id = string(item.id, `${path}.id`, 64);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
      throw new Error(`${path}.id must contain only letters, numbers, underscores, or hyphens and start with a letter or number.`);
    }
    if (ids.has(id)) throw new Error(`Category id "${id}" is duplicated.`);
    ids.add(id);
    if (typeof item.status !== 'string' || !hasOwn(STATUS_LABELS, item.status)) {
      throw new Error(`${path}.status must be available, limited, unavailable, or unknown.`);
    }
    return {
      id,
      name: string(item.name, `${path}.name`, 80),
      description: string(item.description, `${path}.description`, 300, true),
      status: item.status,
    };
  });

  return {
    schemaVersion: 1,
    isDemo: data.isDemo,
    lastUpdatedAt: data.lastUpdatedAt,
    timeZone,
    pantry: {
      name: string(pantry.name, 'pantry.name', 120),
      location: string(pantry.location, 'pantry.location', 160, true),
      address: string(pantry.address, 'pantry.address', 300, true),
      phone: string(pantry.phone, 'pantry.phone', 60, true),
      hours: list(pantry.hours, 'pantry.hours', 14).map((item, index) => {
        const path = `pantry.hours[${index}]`;
        record(item, path);
        return { days: string(item.days, `${path}.days`, 80), time: string(item.time, `${path}.time`, 120) };
      }),
      requirements: list(pantry.requirements, 'pantry.requirements', 16).map((item, index) => string(item, `pantry.requirements[${index}]`, 300)),
      note: string(pantry.note, 'pantry.note', 1000, true),
    },
    categories: checkedCategories,
  };
}

/** Freshness is about the last confirmation, never a guarantee of current stock. */
export function getFreshness(data, now = Date.now()) {
  if (data?.isDemo === true) {
    return { kind: 'demo', label: 'Demo data', detail: 'This pantry and its availability are fictional. This is a demonstration, not a live food resource.' };
  }
  const updated = parseTimestamp(data?.lastUpdatedAt);
  if (!Number.isFinite(updated) || !Number.isFinite(now) || updated - now > CLOCK_SKEW_MS) {
    return { kind: 'unknown', label: 'Update time not confirmed', detail: 'There is no reliable confirmation time. Contact the pantry before making a trip.' };
  }
  let confirmed;
  try {
    confirmed = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: data.timeZone,
    }).format(updated);
  } catch {
    return { kind: 'unknown', label: 'Update time not confirmed', detail: 'The confirmation timezone is invalid. Contact the pantry before making a trip.' };
  }
  const when = `${confirmed} (${data.timeZone})`;
  if (now - updated > DAY_MS) {
    return { kind: 'stale', label: 'Update is over 24 hours old', detail: `Last confirmed ${when}. Availability may have changed. Contact the pantry before making a trip.` };
  }
  return { kind: 'fresh', label: 'Confirmed within 24 hours', detail: `Last confirmed ${when}. Availability can change; an update is not a reservation.` };
}

/** Filter without changing source data. Limited stock counts as last reported in stock. */
export function filterCategories(categories, query = '', availableOnly = false) {
  const needle = String(query ?? '').trim().toLocaleLowerCase('en-US');
  return categories.filter((category) => {
    const matches = `${category.name} ${category.description}`.toLocaleLowerCase('en-US').includes(needle);
    const inStock = category.status === 'available' || category.status === 'limited';
    return matches && (!availableOnly || inStock);
  });
}
