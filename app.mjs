import { STATUS_LABELS, validatePantry, getFreshness, filterCategories } from './data.mjs';

const $ = id => document.getElementById(id);
const create = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const icons = { produce: '🥕', grains: '🍚', canned: '🥫', dairy: '🥛', bread: '🍞', baby: '🍼' };
let publishedData;
let currentData;
let editorData;
let isPreview = false;
let toastTimer;

function announce(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
}

function renderCategories() {
  if (!currentData) return;
  const freshness = getFreshness(currentData);
  const unconfirmed = freshness.kind === 'stale' || freshness.kind === 'unknown';
  // Old reports must not pass the current-stock filter or retain a green stock badge.
  const effective = currentData.categories.map(item => ({ ...item, status: unconfirmed ? 'unknown' : item.status }));
  const matches = filterCategories(effective, $('search').value, $('available-only').checked);
  $('category-grid').replaceChildren();
  matches.forEach(item => {
    const card = create('article', 'food-card' + (unconfirmed ? ' stale-card' : ''));
    const top = create('div', 'food-card-top');
    const icon = create('span', 'food-icon', icons[item.id] || '🥣');
    icon.setAttribute('aria-hidden', 'true');
    const badge = create('span', 'status ' + item.status);
    const dot = create('span', 'dot');
    dot.setAttribute('aria-hidden', 'true');
    badge.append(dot, document.createTextNode(STATUS_LABELS[item.status]));
    top.append(icon, badge);
    card.append(top, create('h4', '', item.name), create('p', '', item.description));
    if (unconfirmed) {
      const original = currentData.categories.find(category => category.id === item.id);
      card.append(create('p', 'last-report', 'Previously reported: ' + STATUS_LABELS[original.status].toLowerCase()));
    }
    $('category-grid').append(card);
  });
  $('result-count').textContent = matches.length + ' of ' + currentData.categories.length + ' categories';
  $('empty-state').hidden = matches.length > 0;
  $('stock-context').textContent = currentData.isDemo
    ? 'Example stock statuses. This is a fictional pantry.'
    : unconfirmed
      ? 'Current availability is not confirmed. Contact the pantry before visiting.'
      : 'Reported by the pantry at the update time shown above.';
}

function render(data) {
  currentData = data;
  $('pantry-content').hidden = false;
  $('demo-banner').hidden = !data.isDemo;
  $('preview-banner').hidden = !isPreview;
  $('pantry-name').textContent = data.pantry.name;
  $('pantry-location').textContent = data.pantry.location || 'Community food pantry';
  $('pantry-address').textContent = data.pantry.address || 'Address not provided. Contact the pantry before visiting.';
  const freshness = getFreshness(data);
  $('freshness').className = 'freshness ' + freshness.kind;
  $('freshness-label').textContent = freshness.label;
  $('freshness-detail').textContent = freshness.detail;
  $('pantry-hours').replaceChildren();
  data.pantry.hours.forEach(row => $('pantry-hours').append(create('dt', '', row.days), create('dd', '', row.time)));
  if (!data.pantry.hours.length) $('pantry-hours').append(create('dt', '', 'Hours not provided. Please confirm before visiting.'));
  $('timezone-label').textContent = 'All hours: ' + data.timeZone.replaceAll('_', ' ');
  $('pantry-requirements').replaceChildren();
  const requirements = data.pantry.requirements.length ? data.pantry.requirements : ['Requirements not provided. Please contact the pantry.'];
  requirements.forEach(text => $('pantry-requirements').append(create('li', '', text)));
  $('pantry-note').textContent = data.pantry.note;
  $('pantry-note').hidden = !data.pantry.note;
  const phone = data.pantry.phone.replace(/[^+0-9]/g, '');
  const callable = !data.isDemo && /^\+?\d{7,15}$/.test(phone);
  $('call-link').hidden = !callable;
  if (callable) {
    $('call-link').href = 'tel:' + phone;
    $('call-link').textContent = 'Call ' + data.pantry.phone + ' ↗';
  } else $('call-link').removeAttribute('href');
  renderCategories();
}

async function load() {
  $('loading').hidden = false;
  $('load-error').hidden = true;
  $('pantry-content').hidden = true;
  $('open-editor').disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(new URL('./pantry.json', import.meta.url), { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Could not retrieve pantry data');
    publishedData = validatePantry(await response.json());
    isPreview = false;
    render(publishedData);
    $('open-editor').disabled = false;
  } catch {
    currentData = undefined;
    $('load-error').hidden = false;
    $('demo-banner').hidden = true;
    $('preview-banner').hidden = true;
  } finally {
    clearTimeout(timeout);
    $('loading').hidden = true;
  }
}

function fillEditor(data) {
  editorData = validatePantry(data);
  $('edit-demo').checked = data.isDemo;
  ['name', 'location', 'address', 'phone', 'note'].forEach(key => { $('edit-' + key).value = data.pantry[key]; });
  $('edit-timezone').value = data.timeZone;
  $('edit-hours').value = data.pantry.hours.map(item => item.days + ' | ' + item.time).join('\n');
  $('edit-requirements').value = data.pantry.requirements.join('\n');
  $('editor-categories').replaceChildren();
  data.categories.forEach((item, index) => {
    const row = create('div', 'editor-row');
    const label = create('label', '', item.name);
    const select = create('select');
    select.id = 'edit-category-' + index;
    label.htmlFor = select.id;
    for (const [value, text] of Object.entries(STATUS_LABELS)) {
      const option = create('option', '', text);
      option.value = value;
      select.append(option);
    }
    select.value = item.status;
    row.append(label, select);
    $('editor-categories').append(row);
  });
  $('confirm-stock').checked = false;
  $('editor-error').hidden = true;
  $('editor-message').textContent = '';
}

function readEditor() {
  $('editor-error').hidden = true;
  $('editor-message').textContent = '';
  if (!$('editor-form').checkValidity()) {
    if ($('editor-form').querySelector('details :invalid')) $('editor-form').querySelector('details').open = true;
    $('editor-form').reportValidity();
    return null;
  }
  const data = structuredClone(editorData);
  data.isDemo = $('edit-demo').checked;
  data.timeZone = $('edit-timezone').value.trim();
  ['name', 'location', 'address', 'phone', 'note'].forEach(key => { data.pantry[key] = $('edit-' + key).value.trim(); });
  data.pantry.hours = $('edit-hours').value.split('\n').filter(line => line.trim()).map(line => {
    const parts = line.split('|');
    if (parts.length !== 2 || !parts.every(part => part.trim())) throw new Error('Enter each schedule as days | time, with one schedule per line.');
    return { days: parts[0].trim(), time: parts[1].trim() };
  });
  data.pantry.requirements = $('edit-requirements').value.split('\n').map(line => line.trim()).filter(Boolean);
  data.categories = data.categories.map((item, index) => ({ ...item, status: $('edit-category-' + index).value }));
  data.lastUpdatedAt = new Date().toISOString();
  return validatePantry(data);
}

function editorError(error) {
  $('editor-error').textContent = error.message || 'Please check the data and try again.';
  $('editor-error').hidden = false;
}

$('open-editor').addEventListener('click', () => {
  fillEditor(currentData);
  $('editor').showModal();
});
$('close-editor').addEventListener('click', () => $('editor').close());
$('editor-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const data = readEditor();
    if (!data) return;
    isPreview = true;
    render(data);
    $('editor').close();
    announce('Preview updated in this browser. Nothing has been published.');
  } catch (error) { editorError(error); }
});
$('download-data').addEventListener('click', () => {
  try {
    const data = readEditor();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = create('a');
    link.href = url;
    link.download = 'pantry.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('editor-message').textContent = 'Data file downloaded. Publish it on GitHub to update the public board.';
  } catch (error) { editorError(error); }
});
$('import-data').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 100000) throw new Error('Please choose a pantry JSON file smaller than 100 KB.');
    const data = validatePantry(JSON.parse(await file.text()));
    fillEditor(data);
    $('editor-message').textContent = 'File loaded into the editor. Review every category before previewing or downloading.';
  } catch (error) { editorError(error); }
  finally { event.target.value = ''; }
});
$('exit-preview').addEventListener('click', () => {
  isPreview = false;
  render(publishedData);
  announce('Showing the published board again.');
});
$('search').addEventListener('input', renderCategories);
$('available-only').addEventListener('change', renderCategories);
$('clear-filters').addEventListener('click', () => {
  $('search').value = '';
  $('available-only').checked = false;
  renderCategories();
  $('search').focus();
});
$('retry').addEventListener('click', load);
// Re-evaluate freshness if this page is left open past the 24-hour threshold.
setInterval(() => { if (currentData) render(currentData); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentData) render(currentData); });
load();
