// The catalog page: paste a GitHub URL, of a repository or of an organization, the skills fill the
// catalog; a card opens its skill.
// A repository's skills arrive one by one, as the server reads them; an organization's repositories
// too, each with its skills, and before them how far listing its repositories has got. The page is
// all there while a scan goes on: more scans, the filter, a skill.
// Nothing is stored: the scanned URLs live in the address, `?repo=<url>`, the open skill in
// `#in=<entry's source>&skill=<id>`: the same skill can be in two entries, at two commits.
// *Group by topic* asks the server's model to group the catalog's skills; until the catalog changes.
// spec/web.md, spec/clustering.md.

/** @typedef {{ id: string, name: string, description: string, summary: string, path: string, link: string,
 *   commit: string, updated: string, copies: string[], properties: Record<string, unknown>, html: string }} Skill */
/** @typedef {{ source: string, ref: string, repository: { id: string, url: string, commit: string },
 *   skills: Skill[], warnings: string[], error?: string, reading?: boolean }} Scan */
/** @typedef {{ source: string, owner: { id: string, url: string }, listed: number, repositories: Scan[],
 *   warnings: string[], scanning?: number, scanned?: number, listing?: Listing }} OrganizationScan */
/** While an organization's repositories are listed, before any is scanned: how many so far, then the
 * SKILL.md files code search found so far. @typedef {{ repositories: number, search?: { found: number, total: number } }} Listing */
/** @typedef {{ key: string, scan?: Scan | OrganizationScan, loading: boolean, controller?: AbortController }} Entry */
/** A skill as the catalog lists it: the entry it opens in, and its repository. @typedef {{ skill: Skill, origin: string, repository: string }} Listed */
/** The catalog by topic: being asked for, or the answer. @typedef {{ controller?: AbortController, topics?: { topic: string, skills: Listed[] }[] }} Grouping */

const $ = (id) => document.getElementById(id);

/** The catalog, in the order the repositories were added. @type {Entry[]} */
let entries = [];
let filter = '';
let catalogScroll = 0;
/** True when the open skill was reached from the catalog, so Back can be the browser's. */
let openedFromCatalog = false;
/** The skill the skill view shows, if it found it. */
let shownSkill;
/** Where the skill view shows it, so showing it again leaves it scrolled where it was. */
let shownAt;
/** The warnings the user opened, which stay open as scans redraw the catalog. */
const openWarnings = new Set();
/** The catalog by topic, if the user asked for it; by repository otherwise. @type {Grouping | undefined} */
let grouping;

/** An element, its attributes and children; text is always text. */
function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  element.append(...children.flat(Infinity).filter((child) => child !== undefined && child !== null && child !== false));
  return element;
}

// Scanning

async function scan(input) {
  input = input.trim();
  if (!input) return;
  showError('');
  // The topics were those of the catalog as it was.
  ungroup();
  const existing = entries.find((entry) => entry.key === input || entry.scan?.source === input);
  if (existing?.loading) {
    // Already being scanned.
    $('scan-url').value = '';
    return;
  }
  const entry = existing ?? { key: input, loading: true };
  const controller = new AbortController();
  Object.assign(entry, { loading: true, controller });
  if (!existing) entries.push(entry);
  render();
  // Where the scan goes, and what was there before it, to put back if it fails.
  let target = entry;
  let previous = entry.scan;
  /**
   * The scan's result so far: another URL for an entry already here replaces that one, where it was.
   * It goes into the address before its cards can be opened; a failure takes it out again.
   */
  const show = (result) => {
    const same = entries.find((other) => other !== entry && other.scan?.source === result.source);
    // A scan that stopped early does not replace the skills already in the catalog.
    if (result.error && (existing?.scan || same)) throw new Error(`Scan incomplete: ${result.error}; ${result.repository.id} is left as it was`);
    if (same && same !== target) {
      entries = entries.filter((other) => other !== entry);
      target = same;
      previous = same.scan;
      same.controller?.abort();
      Object.assign(same, { loading: true, controller });
    }
    Object.assign(target, { key: result.source, scan: result });
    saveAddress();
  };
  try {
    const response = await fetch(`/api/scan?url=${encodeURIComponent(input)}`, {
      headers: { Accept: 'application/x-ndjson, application/json' },
      signal: controller.signal,
    });
    if ((response.headers.get('Content-Type') ?? '').startsWith('application/x-ndjson')) {
      await readLines(response, show);
    } else {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}`);
      show(body);
    }
    target.loading = false;
    // Unless another URL is being typed in already.
    if (!existing && $('scan-url').value.trim() === input) $('scan-url').value = '';
  } catch (error) {
    // Removed while it was scanned: nothing to put back, nothing to say.
    if (controller.signal.aborted) return;
    showError(error instanceof Error ? error.message : String(error));
    // The catalog is left as it was.
    if (previous) Object.assign(target, { key: previous.source, scan: previous, loading: false });
    else entries = entries.filter((other) => other !== target);
  } finally {
    if (target.controller === controller) delete target.controller;
    if (!controller.signal.aborted) {
      saveAddress();
      render();
    }
  }
}

/**
 * A scan, a line at a time: a repository's skills as the server reads them; an organization's
 * repositories, each as its skills are read, in the order the organization lists them. Errors that
 * leave a partial result arrive in that result; errors that stop the scan are raised.
 * @param {Response} response @param {(scan: Scan | OrganizationScan) => void} show
 */
async function readLines(response, show) {
  /** @type {Scan | OrganizationScan | undefined} */
  let scan;
  const scanned = []; // an organization's, by the repository's place in the list; holes for those without skills
  let done = false;
  const take = (line) => {
    const message = JSON.parse(line);
    if (message.type === 'error') throw new Error(message.error);
    if (message.type === 'listing') {
      const { source, owner, repositories, search } = message;
      scan = { source, owner, listed: repositories, repositories: [], warnings: [], listing: { repositories, search } };
    } else if (message.type === 'organization') {
      const { source, owner, listed, scanning } = message;
      scan = { source, owner, listed, repositories: [], warnings: [], scanning, scanned: 0 };
    } else if (message.type === 'opened') {
      const { source, ref, repository } = message;
      scan = { source, ref, repository, skills: [], warnings: [] };
    } else if (!scan) {
      return;
    } else if ('repositories' in scan && message.type === 'skill') {
      const { index, source, ref, repository, skill } = message;
      const reading = scanned[index] ?? { source, ref, repository, skills: [], warnings: [], reading: true };
      scanned[index] = { ...reading, skills: sortSkills([...reading.skills, skill]) };
      scan.repositories = scanned.filter(Boolean);
    } else if ('repositories' in scan && message.type === 'repository') {
      scan.scanned++;
      scanned[message.index] = message.repository;
      scan.repositories = scanned.filter(Boolean);
    } else if ('repositories' in scan && message.type === 'done') {
      scan.warnings = message.warnings;
      done = true;
    } else if (message.type === 'skill') {
      scan = { ...scan, skills: sortSkills([...scan.skills, message.skill]) };
    } else if (message.type === 'done') {
      scan = message.scan;
      done = true;
    } else return;
    show(scan);
    progress();
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { value, done: ended } = await reader.read();
      text += decoder.decode(value, { stream: !ended });
      const lines = text.split('\n');
      text = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) take(line);
      if (ended) break;
    }
    if (text.trim()) take(text);
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }
  if (!done) throw new Error('The scan stopped before it was done; try again');
}

/** By name, then path, in code-unit order: as the server sorts them. @param {Skill[]} skills */
function sortSkills(skills) {
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return skills.sort((a, b) => compare(a.name, b.name) || compare(a.path, b.path));
}

/** A scan got further: the catalog shows it, but a skill already open is left alone, where it was scrolled to. */
function progress() {
  if (openSkill() && shownSkill) return;
  render();
}

function remove(entry) {
  entry.controller?.abort(); // its scan, if it is still going on
  ungroup();
  entries = entries.filter((other) => other !== entry);
  saveAddress();
  render();
}

function showError(message, id = 'scan-error') {
  $(id).textContent = message;
  $(id).hidden = !message;
}

// Topics

/**
 * The catalog's skills, grouped by the server's model, or back by repository if they are already.
 * A failure is an error under the toolbar, and the catalog stays by repository.
 */
async function groupByTopic() {
  if (grouping) {
    ungroup();
    return renderCatalog();
  }
  const listed = catalogSkills();
  const controller = new AbortController();
  grouping = { controller };
  showError('', 'group-error');
  renderCatalog();
  try {
    const skills = listed.map(({ skill }) => ({ id: skill.id, name: skill.name, description: skill.description, body: bodyText(skill.html) }));
    const response = await fetch('/api/cluster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ skills }),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}`);
    const byId = new Map(listed.map((entry) => [entry.skill.id, entry]));
    const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    grouping = {
      topics: body.clusters.map(({ topic, skills }) => ({
        topic,
        skills: skills.map((id) => byId.get(id)).filter(Boolean)
          .sort((a, b) => compare(a.skill.name, b.skill.name) || compare(a.skill.path, b.skill.path)),
      })),
    };
  } catch (error) {
    // The catalog changed while it was asked: nothing to show, nothing to say.
    if (controller.signal.aborted) return;
    grouping = undefined;
    showError(error instanceof Error ? error.message : String(error), 'group-error');
  }
  if (!openSkill()) renderCatalog();
}

/** Back by repository; a question still being asked is dropped. */
function ungroup() {
  grouping?.controller?.abort();
  grouping = undefined;
}

/** Every skill in the catalog once, in the first entry it is in. @returns {Listed[]} */
function catalogSkills() {
  const seen = new Set();
  const listed = [];
  for (const entry of entries) {
    for (const scan of repositoriesOf(entry.scan)) {
      for (const skill of scan.skills) {
        if (seen.has(skill.id)) continue;
        seen.add(skill.id);
        listed.push({ skill, origin: entry.scan.source, repository: scan.repository.id });
      }
    }
  }
  return listed;
}

/** A skill's body as the model reads it: the text of the page's own, safe HTML, a line per block. */
function bodyText(html) {
  const blocks = html.replace(/<\/(p|li|h[1-6]|pre|blockquote|tr|table|ul|ol)>/g, '$&\n');
  return (new DOMParser().parseFromString(blocks, 'text/html').body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

// The address: the only place the catalog is kept

function saveAddress() {
  const params = new URLSearchParams();
  for (const entry of entries) if (entry.scan || entry.loading) params.append('repo', entry.scan?.source ?? entry.key);
  const search = params.size ? `?${params}` : '';
  history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
}

/** The open skill: its id, and the source of the catalog entry it was opened from, if the address says. */
function openSkill() {
  const hash = location.hash.slice(1);
  if (!hash) return undefined;
  const params = new URLSearchParams(hash);
  if (params.has('skill')) return { id: params.get('skill'), source: params.get('in') ?? undefined };
  return { id: decodeURIComponent(hash) }; // `#<id>`: the first copy in the catalog
}

/** The address of a skill of the entry with this source. */
function skillHash(source, id) {
  return `#${new URLSearchParams({ in: source, skill: id })}`;
}

/** A repository's scan, or each of an organization's repositories. @returns {Scan[]} */
function repositoriesOf(scan) {
  if (!scan) return [];
  return 'repositories' in scan ? scan.repositories : [scan];
}

function findSkill({ id, source }) {
  for (const entry of entries) {
    if (source !== undefined && (entry.scan?.source ?? entry.key) !== source) continue;
    for (const scan of repositoriesOf(entry.scan)) {
      const skill = scan.skills.find((skill) => skill.id === id);
      if (skill) return { skill, scan };
    }
  }
  return undefined;
}

// Rendering

function render() {
  const open = openSkill();
  $('catalog-view').hidden = Boolean(open);
  $('skill-view').hidden = !open;
  if (open) renderSkill(open);
  else {
    shownSkill = shownAt = undefined;
    renderCatalog();
  }
}

function matches(skill) {
  if (!filter) return true;
  return [skill.name, skill.description, skill.path].some((text) => text.toLowerCase().includes(filter));
}

function renderCatalog() {
  const scans = entries.flatMap((entry) => repositoriesOf(entry.scan));
  const total = scans.reduce((sum, scan) => sum + scan.skills.length, 0);
  const shown = scans.reduce((sum, scan) => sum + scan.skills.filter(matches).length, 0);
  $('empty').hidden = entries.length > 0;
  $('toolbar').hidden = total === 0;
  $('count').textContent = filter ? `${shown} of ${total} skills` : `${total} ${total === 1 ? 'skill' : 'skills'}`;
  const asking = Boolean(grouping?.controller);
  const group = $('group');
  group.disabled = asking || entries.some((entry) => entry.loading);
  group.setAttribute('aria-pressed', String(Boolean(grouping?.topics)));
  group.replaceChildren(...(asking ? [h('span', { class: 'spinner' }), ' Grouping by topic…'] : [grouping ? 'Show by repository' : 'Group by topic']));
  // Drawn again as scans go on: what had the keyboard's focus keeps it.
  const focused = document.activeElement?.closest?.('[data-focus]')?.getAttribute('data-focus');
  $('repositories').replaceChildren(...(grouping?.topics ? renderTopics(grouping.topics) : entries.map(renderEntry)));
  if (focused) [...document.querySelectorAll('[data-focus]')].find((element) => element.getAttribute('data-focus') === focused)?.focus({ preventScroll: true });
}

/** @param {Entry} entry */
function renderEntry(entry) {
  const { scan } = entry;
  if (!scan) {
    return h('section', { class: 'repository', 'aria-busy': 'true' },
      h('div', { class: 'repository-head' }, h('h2', { class: 'repository-name' }, entry.key)),
      h('div', { class: 'grid' }, h('div', { class: 'card card-loading' }, h('span', {}, h('span', { class: 'spinner' }), ' Scanning…'))));
  }
  if ('repositories' in scan) return renderOrganization(entry, scan);
  return renderRepository(scan, scan.source, entry);
}

/**
 * An organization: its repositories with skills, each as a repository of its own, removed together.
 * While its repositories are listed, how far that has got; while they are scanned, how many are done.
 */
function renderOrganization(entry, scan) {
  const skills = scan.repositories.reduce((sum, repository) => sum + repository.skills.length, 0);
  const { listing } = scan;
  const scanning = entry.loading && !listing && scan.scanning !== undefined;
  return h('section', { class: 'organization', 'data-organization': scan.owner.id, 'aria-busy': entry.loading ? 'true' : undefined },
    h('div', { class: 'repository-head organization-head' },
      h('h2', { class: 'repository-name organization-name' },
        h('a', { href: scan.source, target: '_blank', rel: 'noopener noreferrer' }, scan.owner.id)),
      !listing && h('span', { class: 'badge' }, organizationSummary(skills, scan.repositories.length, scan.listed)),
      scanning && h('span', { class: 'badge badge-muted', 'data-progress': '' }, `scanned ${scan.scanned} of ${scan.scanning}`),
      entry.loading && h('span', { class: 'spinner', 'aria-label': 'Scanning' }),
      removeButton(entry, scan.owner.id)),
    listing && entry.loading && renderListing(listing),
    // The badge says it already: the bar's text is for screen readers only.
    scanning && scan.scanning > 0 && progressBar(`Scanned ${scan.scanned} of ${scan.scanning} repositories`, scan.scanned, scan.scanning, false),
    renderWarnings(scan.warnings, scan.source),
    scan.repositories.length > 0
      ? scan.repositories.map((repository) => renderRepository(repository, scan.source))
      : !listing && h('p', { class: 'muted' }, entry.loading ? 'Scanning its repositories…' : 'No skills in its repositories.'));
}

/**
 * How far listing an organization's repositories has got: GitHub gives them 100 at a time, and code
 * search its SKILL.md files 100 at a time, so a large organization takes a while before any is scanned.
 * @param {Listing} listing
 */
function renderListing({ repositories, search }) {
  const listed = `${repositories} ${repositories === 1 ? 'repository' : 'repositories'}`;
  if (!search) return progressBar(repositories ? `Listing its repositories… ${listed} so far` : 'Listing its repositories…');
  return progressBar(`${listed} listed. Searching them for SKILL.md files… ${search.found} of ${search.total} found`,
    search.found, search.total);
}

/** A step and its bar; without a total, a bar that only says something is going on. */
function progressBar(text, value, max, shown = true) {
  const known = max !== undefined && max > 0;
  return h('div', { class: 'progress', role: 'status', 'data-progress-bar': '' },
    shown && h('span', { class: 'progress-text' }, text),
    h('progress', { class: 'progress-bar', 'aria-label': text, value: known ? value : undefined, max: known ? max : undefined }));
}

/** `N skills in M of K repositories`, as the CLI says it. */
function organizationSummary(skills, withSkills, listed) {
  return `${skills} ${skills === 1 ? 'skill' : 'skills'} in ${withSkills} of ${listed} ${listed === 1 ? 'repository' : 'repositories'}`;
}

/**
 * @param {Scan} scan
 * @param {string} origin the source of the catalog entry it is in, for its cards' addresses
 * @param {Entry} [entry] the catalog entry it is, to remove; none for an organization's repository
 */
function renderRepository(scan, origin, entry) {
  const skills = scan.skills.filter(matches);
  const label = scan.skills.length === 1 ? '1 skill' : `${scan.skills.length} skills`;
  const reading = Boolean(entry?.loading || scan.reading);
  return h('section', { class: 'repository', 'data-repository': scan.repository.id, 'aria-busy': reading ? 'true' : undefined },
    h('div', { class: 'repository-head' },
      h('h2', { class: 'repository-name' },
        h('a', { href: scan.source, target: '_blank', rel: 'noopener noreferrer' }, scan.repository.id)),
      h('span', { class: 'badge' }, label),
      scan.ref && h('span', { class: 'badge badge-muted', title: 'ref' }, scan.ref),
      h('span', { class: 'badge badge-muted', title: scan.repository.commit }, scan.repository.commit.slice(0, 7)),
      reading && h('span', { class: 'spinner', 'aria-label': 'Scanning' }),
      entry && removeButton(entry, scan.repository.id)),
    scan.error && h('p', { class: 'alert alert-error', role: 'alert' },
      `Scan incomplete: ${scan.error}. These are the skills read before it; scan again for the rest.`),
    renderWarnings(scan.warnings, `${origin} ${scan.source}`),
    skills.length > 0
      ? h('div', { class: 'grid' }, skills.map((skill) => renderCard(skill, origin)))
      : h('p', { class: 'muted' }, scan.skills.length ? 'No skill matches the filter.' : reading ? 'Reading its skills…' : 'No skills in this repository.'));
}

function removeButton(entry, name) {
  return h('button', { class: 'button button-ghost', type: 'button', onclick: () => remove(entry), title: `Remove ${name}`, 'data-focus': `remove ${entry.key}` }, 'Remove');
}

/** @param {string[]} warnings @param {string} key what they are of, to keep them open as the catalog is drawn again */
function renderWarnings(warnings, key) {
  return warnings.length > 0 && h('details', { class: 'alert alert-warn', open: openWarnings.has(key),
      ontoggle: (event) => (event.target.open ? openWarnings.add(key) : openWarnings.delete(key)) },
    h('summary', { 'data-focus': `warnings ${key}` }, warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`),
    h('ul', {}, warnings.map((warning) => h('li', {}, warning))));
}

/** The topics with a card the filter keeps: each with its skills, from any repository, each card saying which. */
function renderTopics(topics) {
  const shown = topics
    .map(({ topic, skills }) => ({ topic, skills, cards: skills.filter(({ skill }) => matches(skill)) }))
    .filter(({ cards }) => cards.length > 0);
  if (shown.length === 0) return [h('p', { class: 'muted' }, 'No skill matches the filter.')];
  return shown.map(({ topic, skills, cards }) => h('section', { class: 'topic', 'data-topic': topic },
    h('div', { class: 'repository-head' },
      h('h2', { class: 'repository-name topic-name' }, topic),
      h('span', { class: 'badge' }, skills.length === 1 ? '1 skill' : `${skills.length} skills`)),
    h('div', { class: 'grid' }, cards.map(({ skill, origin, repository }) => renderCard(skill, origin, repository)))));
}

/** @param {Skill} skill @param {string} origin @param {string} [repository] shown on the card, where cards of many repositories mix */
function renderCard(skill, origin, repository) {
  const href = skillHash(origin, skill.id);
  return h('a', { class: 'card', href, 'data-skill': skill.id, 'data-focus': href, onclick: () => {
      catalogScroll = scrollY;
      openedFromCatalog = true;
    } },
    repository && h('span', { class: 'card-repository' }, repository),
    h('span', { class: 'card-title' }, skill.name),
    h('span', { class: 'card-text' }, skill.summary || 'No description.'),
    h('span', { class: 'card-path' }, skill.path),
    skill.updated && h('span', { class: 'card-date' }, 'Updated ', updated(skill)));
}

/** When the skill last changed: the day, in UTC, as the CLI says it; the whole time on hover. @param {Skill} skill */
function updated(skill) {
  return h('time', { datetime: skill.updated, title: skill.updated }, skill.updated.slice(0, 10));
}

function renderSkill(open) {
  const found = findSkill(open);
  shownSkill = found?.skill;
  // The same skill again, now that its scan is done: where it was scrolled to.
  const at = found && `${found.scan.source} ${found.skill.id}`;
  const again = at === shownAt;
  shownAt = at;
  const back = h('button', { class: 'button back', type: 'button', onclick: closeSkill }, '← Back to the catalog');
  if (!found) {
    const loading = entries.some((entry) => entry.loading);
    $('skill-view').replaceChildren(back,
      h('div', { class: 'empty' }, loading
        ? h('p', {}, h('span', { class: 'spinner' }), ' Scanning…')
        : h('p', { class: 'empty-title' }, `${open.id} is not in the catalog`)));
    return;
  }
  const { skill, scan } = found;
  const body = h('article', { class: 'panel prose' });
  if (skill.html.trim()) body.innerHTML = skill.html; // rendered and made safe by the server
  else body.append(h('p', { class: 'prose-empty' }, 'This SKILL.md has no body.'));

  const properties = Object.entries(skill.properties);
  $('skill-view').replaceChildren(
    back,
    h('header', { class: 'skill-head' },
      h('h1', {}, skill.name),
      h('p', { class: 'lead' }, skill.description || 'No description.')),
    h('div', { class: 'skill-layout' },
      body,
      h('aside', { class: 'panel' },
        h('dl', { class: 'meta' },
          h('dt', {}, 'Repository'), h('dd', {}, h('a', { href: scan.source, target: '_blank', rel: 'noopener noreferrer' }, scan.repository.id)),
          h('dt', {}, 'Path'), h('dd', {}, h('code', {}, skill.path)),
          h('dt', {}, 'Commit'), h('dd', {}, h('code', { title: skill.commit }, skill.commit.slice(0, 12))),
          skill.updated && [h('dt', {}, 'Updated'), h('dd', { 'data-updated': '' }, updated(skill))],
          h('dt', {}, 'SKILL.md'), h('dd', {}, h('a', { href: skill.link, target: '_blank', rel: 'noopener noreferrer', 'data-link': '' }, 'Open on GitHub ↗')),
          skill.copies.length > 0 && [h('dt', {}, 'Also in'), h('dd', {}, h('ul', {}, skill.copies.map((copy) => h('li', {}, h('code', {}, copy)))))],
          properties.map(([key, value]) => [h('dt', {}, key), h('dd', {}, formatValue(value))])))));
  if (!again) scrollTo(0, 0);
}

function formatValue(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return h('pre', {}, JSON.stringify(value, null, 2));
}

function closeSkill() {
  if (openedFromCatalog) return history.back();
  history.pushState(null, '', `${location.pathname}${location.search}`);
  render();
}

// Start

$('scan-form').addEventListener('submit', (event) => {
  event.preventDefault();
  scan($('scan-url').value);
});
$('group').addEventListener('click', groupByTopic);
$('filter').addEventListener('input', (event) => {
  filter = event.target.value.trim().toLowerCase();
  renderCatalog();
});
document.querySelector('[data-home]').addEventListener('click', (event) => {
  event.preventDefault();
  if (openSkill()) closeSkill();
});
addEventListener('hashchange', () => {
  const wasOpen = !$('skill-view').hidden;
  render();
  if (wasOpen && !openSkill()) {
    openedFromCatalog = false;
    scrollTo(0, catalogScroll);
  }
});

for (const input of new URLSearchParams(location.search).getAll('repo')) scan(input);
render();
