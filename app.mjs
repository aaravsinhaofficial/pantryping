import { STATUS_LABELS, validatePantry, getFreshness, filterCategories } from './data.mjs';
import { parseInventoryCSV, inventoryCSVTemplate } from './import.mjs';
import { prepareAI, signInAI, generateStockSuggestions } from './ai.mjs';
import { preparePublishLink, pantryBlobSha } from './publish.mjs';

const $ = id => document.getElementById(id);
const create = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const icons = { produce: '🥕', grains: '🍚', canned: '🥫', dairy: '🥛', bread: '🍞', baby: '🍼' };
const selected = new Set();
let publishedData, publishedSha, currentData, editorData;
let isPreview = false;
let toastTimer, editorRevision = 0, editorSession = 0;
let baseline = new Map();

function announce(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
}
function effectiveCategories() {
  const kind = getFreshness(currentData).kind;
  return currentData.categories.map(item => ({ ...item, status: ['stale', 'unknown'].includes(kind) ? 'unknown' : item.status }));
}
function stockBadge(status) {
  const badge = create('span', 'status ' + status);
  const dot = create('span', 'dot');
  dot.setAttribute('aria-hidden', 'true');
  badge.append(dot, document.createTextNode(STATUS_LABELS[status]));
  return badge;
}
function renderCategories() {
  if (!currentData) return;
  const unconfirmed = ['stale', 'unknown'].includes(getFreshness(currentData).kind);
  const matches = filterCategories(effectiveCategories(), $('search').value, $('available-only').checked);
  $('category-grid').replaceChildren();
  matches.forEach(item => {
    const card = create('article', 'food-card' + (unconfirmed ? ' stale-card' : '') + (selected.has(item.id) ? ' selected-card' : ''));
    const top = create('div', 'food-card-top');
    const icon = create('span', 'food-icon', icons[item.id] || '🥣');
    icon.setAttribute('aria-hidden', 'true');
    top.append(icon, stockBadge(item.status));
    card.append(top, create('h4', '', item.name), create('p', '', item.description));
    if (unconfirmed) {
      const original = currentData.categories.find(category => category.id === item.id);
      card.append(create('p', 'last-report', 'Previously reported: ' + STATUS_LABELS[original.status].toLowerCase()));
    }
    const button = create('button', 'add-to-list', selected.has(item.id) ? '✓ On my list' : '+ Add to my list');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(selected.has(item.id)));
    button.setAttribute('aria-label', (selected.has(item.id) ? 'Remove ' : 'Add ') + item.name + (selected.has(item.id) ? ' from my list' : ' to my list'));
    button.addEventListener('click', () => {
      selected.has(item.id) ? selected.delete(item.id) : selected.add(item.id);
      renderCategories();
      // Keep keyboard focus on the corresponding replacement button.
      [...$('category-grid').querySelectorAll('.add-to-list')][matches.indexOf(item)]?.focus({ preventScroll: true });
    });
    card.append(button);
    $('category-grid').append(card);
  });
  $('result-count').textContent = matches.length + ' of ' + currentData.categories.length + ' categories';
  $('empty-state').hidden = matches.length > 0;
  $('stock-context').textContent = currentData.isDemo
    ? 'Example stock statuses. This is a fictional pantry.'
    : unconfirmed ? 'Current availability is not confirmed. Contact the pantry before visiting.'
      : 'Reported by the pantry at the update time shown above.';
  renderList();
}
function renderList() {
  const items = effectiveCategories().filter(item => selected.has(item.id));
  for (const id of selected) if (!currentData.categories.some(item => item.id === id)) selected.delete(id);
  $('list-count').textContent = items.length;
  $('visit-list').replaceChildren();
  items.forEach(item => {
    const row = create('li');
    const remove = create('button', 'remove-item', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove ' + item.name + ' from my visit list');
    remove.addEventListener('click', () => { selected.delete(item.id); renderCategories(); $('my-list-title').focus(); });
    row.append(create('span', 'list-item-name', item.name), stockBadge(item.status), remove);
    $('visit-list').append(row);
  });
  const available = items.filter(item => ['available', 'limited'].includes(item.status)).length;
  const limited = items.filter(item => item.status === 'limited').length;
  $('list-summary').textContent = items.length
    ? (currentData.isDemo ? 'Demo: ' : '') + available + ' of ' + items.length + ' selected categories reported in stock.' + (limited ? ' ' + limited + ' limited—call first.' : '')
    : 'Tap “Add to my list” on the foods you need.';
  $('list-actions').hidden = !items.length;
  $('clear-list').hidden = !items.length;
  $('copy-fallback').hidden = true;
}
function visitPlan() {
  const data = currentData;
  const lines = ['PantryPing — My visit plan', data.pantry.name];
  if (data.isDemo) lines.push('DEMO ONLY — fictional pantry. Do not plan a real visit.');
  if (isPreview) lines.push('LOCAL PREVIEW — this data has not been published.');
  const freshness = getFreshness(data);
  lines.push(freshness.label + ': ' + freshness.detail, '', 'My list:');
  effectiveCategories().filter(item => selected.has(item.id)).forEach(item => lines.push('• ' + item.name + ' — ' + STATUS_LABELS[item.status]));
  lines.push('', 'Location: ' + (data.pantry.address || 'Not provided'));
  if (data.pantry.phone) lines.push('Public phone: ' + data.pantry.phone);
  lines.push('Hours (' + data.timeZone + '):');
  data.pantry.hours.forEach(row => lines.push(row.days + ': ' + row.time));
  if (!data.pantry.hours.length) lines.push('Not provided. Please confirm before visiting.');
  lines.push('', 'Before you arrive:');
  data.pantry.requirements.forEach(text => lines.push('• ' + text));
  if (data.pantry.note) lines.push(data.pantry.note);
  lines.push('', 'Availability may change. Limited supplies may run out. This list does not reserve food.', location.href.split('#')[0]);
  return lines.join('\n');
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
  if (callable) { $('call-link').href = 'tel:' + phone; $('call-link').textContent = 'Call ' + data.pantry.phone + ' ↗'; }
  else $('call-link').removeAttribute('href');
  $('directions-link').hidden = data.isDemo || !data.pantry.address;
  if (!data.isDemo && data.pantry.address) $('directions-link').href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(data.pantry.address);
  else $('directions-link').removeAttribute('href');
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
    const raw = await response.text();
    publishedData = validatePantry(JSON.parse(raw));
    publishedSha = await pantryBlobSha(raw);
    isPreview = false;
    render(publishedData);
    $('open-editor').disabled = false;
  } catch {
    currentData = undefined;
    $('load-error').hidden = false;
    $('demo-banner').hidden = true;
    $('preview-banner').hidden = true;
  } finally { clearTimeout(timeout); $('loading').hidden = true; }
}
function invalidateDraft() {
  editorRevision++;
  $('confirm-stock').checked = false;
  $('publish-ready').hidden = true;
  $('publish-link').removeAttribute('href');
  $('editor-message').textContent = '';
}
function updateReview() {
  let changed = 0;
  editorData.categories.forEach((item, index) => {
    const value = $('edit-category-' + index).value;
    const previous = baseline.get(item.id);
    const isChanged = previous !== value;
    changed += isChanged ? 1 : 0;
    $('row-' + index).classList.toggle('changed-row', isChanged);
    $('previous-' + index).textContent = isChanged ? 'Was ' + (STATUS_LABELS[previous] || 'not listed').toLowerCase() : 'No change';
  });
  $('review-count').textContent = changed + ' changed';
}
function fillEditor(data, { keepBaseline = false } = {}) {
  editorSession++;
  invalidateDraft();
  editorData = validatePantry(data);
  if (!keepBaseline) baseline = new Map(data.categories.map(item => [item.id, item.status]));
  // A new inventory review must not carry old availability forward as if freshly checked.
  if (['stale', 'unknown'].includes(getFreshness(data).kind)) editorData.categories.forEach(item => { item.status = 'unknown'; });
  $('edit-demo').checked = data.isDemo;
  ['name', 'location', 'address', 'phone', 'note'].forEach(key => { $('edit-' + key).value = data.pantry[key]; });
  $('edit-timezone').value = data.timeZone;
  $('edit-hours').value = data.pantry.hours.map(item => item.days + ' | ' + item.time).join('\n');
  $('edit-requirements').value = data.pantry.requirements.join('\n');
  $('editor-categories').replaceChildren();
  editorData.categories.forEach((item, index) => {
    const row = create('div', 'editor-row'); row.id = 'row-' + index;
    const label = create('label', '', item.name);
    const detail = create('span', 'previous-status'); detail.id = 'previous-' + index;
    const evidence = create('span', 'suggestion-evidence'); evidence.id = 'evidence-' + index;
    const labelGroup = create('div'); labelGroup.append(label, detail, evidence);
    const select = create('select'); select.id = 'edit-category-' + index; label.htmlFor = select.id;
    for (const [value, text] of Object.entries(STATUS_LABELS)) {
      const option = create('option', '', text); option.value = value; select.append(option);
    }
    select.value = item.status;
    select.addEventListener('change', () => { evidence.textContent = ''; updateReview(); });
    row.append(labelGroup, select); $('editor-categories').append(row);
  });
  $('editor-error').hidden = true;
  $('import-message').hidden = true;
  updateReview();
}
function readEditor() {
  $('editor-error').hidden = true;
  $('editor-message').textContent = '';
  if (!$('editor-form').checkValidity()) {
    if ($('pantry-details').querySelector(':invalid')) $('pantry-details').open = true;
    $('editor-form').reportValidity(); return null;
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
function applySuggestions(updates, source) {
  invalidateDraft();
  updates.forEach(update => {
    const index = editorData.categories.findIndex(item => item.id === update.id);
    if (index < 0) return;
    $('edit-category-' + index).value = update.status;
    $('evidence-' + index).textContent = update.evidence ? (source === 'AI' ? 'AI quote: “' + update.evidence + '”' : update.evidence) : 'Not included in this update';
  });
  updateReview();
}
function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = create('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importFile(file) {
  if (!file) return;
  const session = ++editorSession;
  const revision = editorRevision;
  $('editor-error').hidden = true;
  $('import-message').hidden = true;
  try {
    if (file.size > 100000) throw new Error('Choose a CSV or JSON file smaller than 100 KB.');
    if (!/\.(csv|json)$/i.test(file.name)) throw new Error('Choose a .csv spreadsheet or a PantryPing .json file.');
    const text = await file.text();
    if (session !== editorSession) return;
    if (revision !== editorRevision) { $('import-message').textContent = 'Your draft changed while the file was loading. Upload it again if you want to replace these edits.'; $('import-message').hidden = false; return; }
    if (/\.json$/i.test(file.name)) fillEditor(validatePantry(JSON.parse(text)), { keepBaseline: true });
    else { applySuggestions(parseInventoryCSV(text, editorData.categories), 'CSV'); editorSession++; }
    $('import-message').textContent = '✓ ' + file.name + ' loaded. Review the statuses below; nothing has been published.';
    $('import-message').hidden = false;
  } catch (error) { editorError(error instanceof SyntaxError ? new Error('This JSON could not be read. Choose a valid PantryPing backup or use the CSV template.') : error); }
}
function choosePanel(name) {
  document.querySelectorAll('.entry-tab').forEach(button => {
    const active = button.dataset.panel === name;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    $('panel-' + button.dataset.panel).hidden = !active;
  });
}
$('open-editor').addEventListener('click', () => { fillEditor(currentData); $('editor').showModal(); });
$('close-editor').addEventListener('click', () => { editorSession++; $('editor').close(); });
$('editor').addEventListener('cancel', () => { editorSession++; });
$('editor-form').addEventListener('input', event => { if (event.target.id !== 'confirm-stock' || !event.target.checked) invalidateDraft(); });
$('editor-form').addEventListener('submit', event => {
  event.preventDefault();
  try { const data = readEditor(); if (!data) return; isPreview = true; render(data); editorSession++; $('editor').close(); announce('Preview updated in this tab. Nothing has been published.'); }
  catch (error) { editorError(error); }
});
$('prepare-publish').addEventListener('click', async () => {
  try {
    const data = readEditor(); if (!data) return;
    const revision = editorRevision;
    $('prepare-publish').disabled = true;
    $('editor-message').textContent = 'Preparing your update and checking the latest board…';
    const result = await preparePublishLink(data, undefined, publishedSha);
    if (revision !== editorRevision || !$('confirm-stock').checked) { $('editor-message').textContent = 'Your draft changed. Review it and click Publish again.'; return; }
    $('publish-link').href = result.url; $('publish-ready').hidden = false;
    $('editor-message').textContent = '';
    $('publish-link').focus();
  } catch (error) { editorError(error); $('editor-message').textContent = ''; }
  finally { $('prepare-publish').disabled = false; }
});
$('download-data').addEventListener('click', () => {
  try { const data = readEditor(); if (!data) return; download(JSON.stringify(data, null, 2) + '\n', 'pantry.json', 'application/json'); $('editor-message').textContent = 'Backup downloaded. This does not update the public board.'; }
  catch (error) { editorError(error); }
});
$('download-template').addEventListener('click', () => { download(inventoryCSVTemplate(editorData.categories), 'pantryping-stock-template.csv', 'text/csv'); announce('CSV template downloaded. Fill in each category’s status, then drop it here.'); });
$('import-data').addEventListener('change', event => { importFile(event.target.files[0]); event.target.value = ''; });
['dragenter', 'dragover'].forEach(name => $('drop-zone').addEventListener(name, event => { event.preventDefault(); $('drop-zone').classList.add('drag-over'); }));
['dragleave', 'drop'].forEach(name => $('drop-zone').addEventListener(name, event => { event.preventDefault(); $('drop-zone').classList.remove('drag-over'); }));
$('drop-zone').addEventListener('drop', event => {
  if (event.dataTransfer.files.length !== 1) return editorError(new Error('Drop one CSV or JSON file at a time.'));
  importFile(event.dataTransfer.files[0]);
});
document.querySelectorAll('.entry-tab').forEach(button => button.addEventListener('click', () => choosePanel(button.dataset.panel)));
$('example-note').addEventListener('click', () => {
  $('ai-note').value = 'Fresh produce is available. Rice and pasta are available. Milk and dairy are running low. Baby essentials are out of stock.';
  $('ai-note').focus(); $('ai-message').textContent = 'Example only. Replace it with your actual stock notes before generating for a real pantry.';
});
$('enable-ai').addEventListener('click', async () => {
  $('enable-ai').disabled = true; $('ai-message').textContent = 'Connecting to Puter…';
  try {
    const { signedIn } = await prepareAI(); $('enable-ai').hidden = true;
    $('signin-ai').hidden = signedIn; $('generate-ai').hidden = !signedIn;
    $('ai-message').textContent = signedIn ? 'Connected. Generate when your stock note is ready.' : 'Ready to connect your account. Sign in opens a Puter window.';
  } catch (error) { $('ai-message').textContent = error.message; }
  finally { $('enable-ai').disabled = false; }
});
$('signin-ai').addEventListener('click', async () => {
  // Call synchronously from this user click so the provider can open its sign-in window.
  const signingIn = signInAI(); $('signin-ai').disabled = true;
  try { await signingIn; $('signin-ai').hidden = true; $('generate-ai').hidden = false; $('ai-message').textContent = 'Signed in. Review your note, then generate suggestions.'; }
  catch (error) { $('ai-message').textContent = error.message; }
  finally { $('signin-ai').disabled = false; }
});
$('generate-ai').addEventListener('click', async () => {
  const note = $('ai-note').value.trim(); const session = editorSession; const revision = editorRevision;
  $('generate-ai').disabled = true;
  try {
    const updates = await generateStockSuggestions(note, editorData.categories, { onStatus: message => { $('ai-message').textContent = message; } });
    if (session !== editorSession || revision !== editorRevision || note !== $('ai-note').value.trim()) { $('ai-message').textContent = 'The draft changed while AI was working. Generate again to use the current draft.'; return; }
    applySuggestions(updates, 'AI');
    $('ai-message').textContent = 'Suggestions added below with quotes from your note. AI can misread notes—review every status.';
    $('import-message').textContent = '✦ AI draft ready for review. Unmentioned categories are Not confirmed.'; $('import-message').hidden = false;
  } catch (error) { $('ai-message').textContent = error.message; $('signin-ai').hidden = false; }
  finally { $('generate-ai').disabled = false; }
});
$('exit-preview').addEventListener('click', () => { isPreview = false; render(publishedData); announce('Showing the published board again.'); });
$('search').addEventListener('input', renderCategories);
$('available-only').addEventListener('change', renderCategories);
$('clear-filters').addEventListener('click', () => { $('search').value = ''; $('available-only').checked = false; renderCategories(); $('search').focus(); });
$('clear-list').addEventListener('click', () => { selected.clear(); renderCategories(); });
$('copy-list').addEventListener('click', async () => {
  const plan = visitPlan();
  try { await navigator.clipboard.writeText(plan); announce('Visit plan copied, including hours and requirements.'); }
  catch { $('copy-fallback').value = plan; $('copy-fallback').hidden = false; $('copy-fallback').focus(); $('copy-fallback').select(); announce('Select and copy the plan below.'); }
});
$('print-list').addEventListener('click', () => { $('print-plan').textContent = visitPlan(); window.print(); });
$('retry').addEventListener('click', load);
$('refresh-board').addEventListener('click', load);
$('my-list-title').tabIndex = -1;
setInterval(() => { if (currentData) render(currentData); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentData) render(currentData); });
load();
