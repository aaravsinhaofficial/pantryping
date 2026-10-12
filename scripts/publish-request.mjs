import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validatePantry } from '../data.mjs';
import { PUBLISH_TITLE, REPOSITORY } from '../publish.mjs';

const SHA = /^[a-f0-9]{40}$/;
const WINDOW_MS = 15 * 60 * 1000;

class PublishError extends Error {
  constructor(message) { super(message); this.name = 'PublishError'; }
}

/** Treat every issue field as untrusted data, never as executable code. */
export function validatePublishRequest(event, { repository = REPOSITORY, now = Date.now() } = {}) {
  if (repository !== REPOSITORY || event?.repository?.full_name !== repository) {
    throw new PublishError('The request does not belong to the configured PantryPing repository.');
  }
  const issue = event?.issue;
  if (event.action !== 'opened' || issue?.title !== PUBLISH_TITLE || issue.pull_request) {
    throw new PublishError('This is not a newly opened PantryPing publication request.');
  }
  // Intentionally owner-only: opening an issue is public; it does not grant write access.
  if (issue?.user?.login !== repository.split('/')[0]) {
    throw new PublishError('Only the repository owner can publish pantry updates. No data was changed.');
  }
  if (!Number.isSafeInteger(issue.number) || issue.number < 1 || typeof issue.body !== 'string' || issue.body.length > 30000) {
    throw new PublishError('The publication request is malformed or too large.');
  }
  const blocks = [...issue.body.matchAll(/```json[ \t]*\r?\n([\s\S]*?)\r?\n```/g)];
  if (blocks.length !== 1) throw new PublishError('The request must contain exactly one JSON data block.');
  let payload;
  try { payload = JSON.parse(blocks[0][1]); } catch {
    throw new PublishError('The JSON data could not be read. Prepare a new request from the staff editor.');
  }
  if (payload?.kind !== 'pantryping-publish' || payload?.version !== 1 || !SHA.test(payload?.baseSha ?? '')) {
    throw new PublishError('The publication format is invalid. Prepare a new request from the staff editor.');
  }
  let data;
  try { data = validatePantry(payload.data); } catch {
    // Do not echo untrusted JSON or private notes into logs/comments.
    throw new PublishError('The pantry data failed validation. Review it in the staff editor and prepare a new request.');
  }
  const confirmedAt = Date.parse(data.lastUpdatedAt);
  if (!Number.isFinite(now) || !Number.isFinite(confirmedAt) || Math.abs(now - confirmedAt) > WINDOW_MS) {
    throw new PublishError('The confirmation is older than 15 minutes or has an invalid time. Confirm the information again in the staff editor and create a new request.');
  }
  return { baseSha: payload.baseSha, data, issueNumber: issue.number };
}

/** Only pantry.json is writable, and every write requires its expected current SHA. */
export async function processPublishRequest(event, {
  repository = REPOSITORY,
  token,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  let request;
  try { request = validatePublishRequest(event, { repository, now }); } catch (error) {
    return { published: false, message: error instanceof PublishError ? error.message : 'Invalid publication request.' };
  }
  if (!token) return { published: false, message: 'GitHub authorization is unavailable. No data was changed.' };
  const url = `https://api.github.com/repos/${repository}/contents/pantry.json`;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  try {
    const currentResponse = await fetchImpl(`${url}?ref=main`, {
      headers, signal: AbortSignal.timeout(15000),
    });
    if (!currentResponse.ok) return { published: false, message: 'The current pantry file could not be checked. No data was changed.' };
    const current = await currentResponse.json();
    if (current?.type !== 'file' || current?.path !== 'pantry.json' || !SHA.test(current?.sha ?? '')) {
      return { published: false, message: 'The current pantry file has an unexpected format. No data was changed.' };
    }
    if (current.sha !== request.baseSha) {
      return { published: false, message: 'A newer pantry update was published after this request was prepared. Reload the staff editor, review the latest information, and prepare a new update. Nothing was overwritten.' };
    }
    const writeResponse = await fetchImpl(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        message: `Publish pantry update from issue #${request.issueNumber}`,
        content: Buffer.from(`${JSON.stringify(request.data, null, 2)}\n`, 'utf8').toString('base64'),
        sha: request.baseSha,
        branch: 'main',
      }),
    });
    if (writeResponse.status === 409 || writeResponse.status === 422) {
      return { published: false, message: 'GitHub rejected the update, possibly because a newer update arrived. Reload the staff editor and prepare a new request. No forced overwrite was attempted.' };
    }
    if (!writeResponse.ok) return { published: false, message: 'GitHub did not accept this update. Check repository permissions and try a new request.' };
    return {
      published: true,
      message: 'Your pantry update was saved to pantry.json. The Pages deployment is now queued in this workflow. Check its Actions run for deployment completion, then refresh the public page.',
    };
  } catch {
    return { published: false, message: 'GitHub could not confirm the result. Check pantry.json and the Actions run before preparing another request.' };
  }
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  // Ignore ordinary issues without producing noise or comments.
  if (event?.issue?.title !== PUBLISH_TITLE) {
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'published=false\n');
    return;
  }
  const result = await processPublishRequest(event, { repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN });
  // Set the output before commenting: a comments outage must not prevent deployment.
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `published=${result.published}\n`);
  console.log(result.message);
  const number = event?.issue?.number;
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY || !Number.isSafeInteger(number) || number < 1) return;
  const url = `https://api.github.com/repos/${REPOSITORY}/issues/${number}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  try {
    const comment = await fetch(`${url}/comments`, { method: 'POST', headers, body: JSON.stringify({ body: result.message }), signal: AbortSignal.timeout(15000) });
    if (!comment.ok) console.log('The result comment could not be posted; see this Actions run.');
    if (result.published) {
      const closed = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ state: 'closed', state_reason: 'completed' }), signal: AbortSignal.timeout(15000) });
      if (!closed.ok) console.log('The update was saved, but the request issue could not be closed.');
    }
  } catch { console.log('The issue status could not be updated; see this Actions run.'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('The publication workflow could not read its event or write its result.'); process.exitCode = 1; });
}
