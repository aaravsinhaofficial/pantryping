import { validatePantry } from './data.mjs';

export const PUBLISH_TITLE = '[PantryPing] Publish update';
export const REPOSITORY = 'aaravsinhaofficial/pantryping';
const CONTENTS_URL = `https://api.github.com/repos/${REPOSITORY}/contents/pantry.json?ref=main`;

/** Hash the exact fetched text as a Git blob, using its UTF-8 byte count. */
export async function pantryBlobSha(text) {
  if (typeof text !== 'string') throw new Error('The pantry file must be text.');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const header = encoder.encode(`blob ${bytes.byteLength}\0`);
  const blob = new Uint8Array(header.byteLength + bytes.byteLength);
  blob.set(header);
  blob.set(bytes, header.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-1', blob);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Prepare a public request. GitHub handles sign-in; the browser never needs a token. */
export async function preparePublishLink(value, fetchImpl = globalThis.fetch, expectedSha) {
  const data = validatePantry(value);
  const confirmedAt = Date.parse(data.lastUpdatedAt);
  if (!Number.isFinite(confirmedAt) || Math.abs(Date.now() - confirmedAt) > 15 * 60 * 1000) {
    throw new Error('Confirm this update again before publishing. Its confirmation time must be within the last 15 minutes.');
  }
  let response;
  try {
    response = await fetchImpl(CONTENTS_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Cannot reach GitHub right now. Try again, or download your update as a backup.');
  }
  if (!response.ok) {
    throw new Error(response.status === 403 || response.status === 429
      ? 'GitHub is temporarily limiting requests. Wait a few minutes and try again, or download your update.'
      : 'Cannot check the published pantry data. Try again, or download your update as a backup.');
  }
  let current;
  try { current = await response.json(); } catch { /* checked below */ }
  if (current?.type !== 'file' || current?.path !== 'pantry.json' || !/^[a-f0-9]{40}$/.test(current?.sha ?? '')) {
    throw new Error('GitHub returned an unexpected pantry file. Your update has not been published.');
  }
  const baseSha = current.sha;
  if (expectedSha !== undefined && baseSha !== expectedSha) {
    throw new Error('The published pantry changed while you were editing. Download your draft as a backup, reload the latest information, and review your changes before publishing. Nothing was overwritten.');
  }
  const payload = { kind: 'pantryping-publish', version: 1, baseSha, data };
  const body = [
    'Publish the reviewed public pantry information below.',
    '',
    'Only the repository owner can publish through this form. This issue and its contents are public. Do not include visitor names, contact details, or other private information.',
    '',
    'Submitting this issue requests publication. The workflow validates the data and checks that no newer pantry update would be overwritten. Publication and deployment status appear in the comments and Actions.',
    '',
    '```json',
    JSON.stringify(payload),
    '```',
  ].join('\n');
  const link = new URL(`https://github.com/${REPOSITORY}/issues/new`);
  link.searchParams.set('title', PUBLISH_TITLE);
  link.searchParams.set('body', body);
  if (link.href.length > 12000) {
    throw new Error('This update is too large for the GitHub publish form. Shorten the notes or download pantry.json and upload it to the repository.');
  }
  return { url: link.href, baseSha };
}
