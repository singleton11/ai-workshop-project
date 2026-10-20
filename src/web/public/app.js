// The catalog page: paste a GitHub URL, of a repository or of an organization, the skills fill the
// catalog; a card opens its skill.
// Nothing is stored: the scanned URLs live in the address, `?repo=<url>`, the open skill in `#<id>`.
// spec/web.md.

/** @typedef {{ id: string, name: string, description: string, summary: string, path: string, link: string,
 *   commit: string, copies: string[], properties: Record<string, unknown>, html: string }} Skill */
/** @typedef {{ source: string, ref: string, repository: { id: string, url: string, commit: string },
 *   skills: Skill[], warnings: string[] }} Scan */
/** @typedef {{ source: string, owner: { id: string, url: string }, listed: number, repositories: Scan[],
 *   warnings: string[] }} OrganizationScan */
/** @typedef {{ key: string, scan?: Scan | OrganizationScan, loading: boolean }} Entry */

const $ = (id) => document.getElementById(id);

/** The catalog, in the order the repositories were added. @type {Entry[]} */
let entries = [];
let filter = '';
let catalogScroll = 0;
/** True when the open skill was reached from the catalog, so Back can be the browser's. */
let openedFromCatalog = false;

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
  const existing = entries.find((entry) => entry.key === input || entry.scan?.source === input);
  const entry = existing ?? { key: input, loading: true };
  entry.loading = true;
  if (!existing) entries.push(entry);
  render();
  setBusy(true);
  try {
    const response = await fetch(`/api/scan?url=${encodeURIComponent(input)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}`);
    /** @type {Scan} */
    const result = body;
    // Another URL for a repository already here: the new scan replaces it, where it was.
    const same = entries.find((other) => other !== entry && other.scan?.source === result.source);
    if (same) entries = entries.filter((other) => other !== entry);
    Object.assign(same ?? entry, { key: result.source, scan: result, loading: false });
    if (!existing) $('scan-url').value = '';
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    // The catalog is left as it was.
    if (existing?.scan) existing.loading = false;
    else entries = entries.filter((other) => other !== entry);
  } finally {
    setBusy(entries.some((other) => other.loading));
    saveAddress();
    render();
  }
}

function remove(entry) {
  entries = entries.filter((other) => other !== entry);
  saveAddress();
  render();
}

function setBusy(busy) {
  const button = $('scan-button');
  button.disabled = busy;
  button.replaceChildren(...(busy ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Scanning…'] : ['Scan']));
}

function showError(message) {
  $('scan-error').textContent = message;
  $('scan-error').hidden = !message;
}

// The address: the only place the catalog is kept

function saveAddress() {
  const params = new URLSearchParams();
  for (const entry of entries) if (entry.scan || entry.loading) params.append('repo', entry.scan?.source ?? entry.key);
  const search = params.size ? `?${params}` : '';
  history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
}

function openSkillId() {
  return location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : '';
}

/** A repository's scan, or each of an organization's repositories. @returns {Scan[]} */
function repositoriesOf(scan) {
  if (!scan) return [];
  return 'repositories' in scan ? scan.repositories : [scan];
}

function findSkill(id) {
  for (const entry of entries) {
    for (const scan of repositoriesOf(entry.scan)) {
      const skill = scan.skills.find((skill) => skill.id === id);
      if (skill) return { skill, scan };
    }
  }
  return undefined;
}

// Rendering

function render() {
  const id = openSkillId();
  $('catalog-view').hidden = Boolean(id);
  $('skill-view').hidden = !id;
  if (id) renderSkill(id);
  else renderCatalog();
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
  $('repositories').replaceChildren(...entries.map(renderEntry));
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
  return renderRepository(scan, entry);
}

/** An organization: its repositories with skills, each as a repository of its own, removed together. */
function renderOrganization(entry, scan) {
  const skills = scan.repositories.reduce((sum, repository) => sum + repository.skills.length, 0);
  return h('section', { class: 'organization', 'data-organization': scan.owner.id, 'aria-busy': entry.loading ? 'true' : undefined },
    h('div', { class: 'repository-head organization-head' },
      h('h2', { class: 'repository-name organization-name' },
        h('a', { href: scan.source, target: '_blank', rel: 'noopener noreferrer' }, scan.owner.id)),
      h('span', { class: 'badge' }, organizationSummary(skills, scan.repositories.length, scan.listed)),
      entry.loading && h('span', { class: 'spinner', 'aria-label': 'Scanning' }),
      removeButton(entry, scan.owner.id)),
    renderWarnings(scan.warnings),
    scan.repositories.length > 0
      ? scan.repositories.map((repository) => renderRepository(repository))
      : h('p', { class: 'muted' }, 'No skills in its repositories.'));
}

/** `N skills in M of K repositories`, as the CLI says it. */
function organizationSummary(skills, withSkills, listed) {
  return `${skills} ${skills === 1 ? 'skill' : 'skills'} in ${withSkills} of ${listed} ${listed === 1 ? 'repository' : 'repositories'}`;
}

/**
 * @param {Scan} scan
 * @param {Entry} [entry] the catalog entry it is, to remove; none for an organization's repository
 */
function renderRepository(scan, entry) {
  const skills = scan.skills.filter(matches);
  const label = scan.skills.length === 1 ? '1 skill' : `${scan.skills.length} skills`;
  return h('section', { class: 'repository', 'data-repository': scan.repository.id, 'aria-busy': entry?.loading ? 'true' : undefined },
    h('div', { class: 'repository-head' },
      h('h2', { class: 'repository-name' },
        h('a', { href: scan.source, target: '_blank', rel: 'noopener noreferrer' }, scan.repository.id)),
      h('span', { class: 'badge' }, label),
      scan.ref && h('span', { class: 'badge badge-muted', title: 'ref' }, scan.ref),
      h('span', { class: 'badge badge-muted', title: scan.repository.commit }, scan.repository.commit.slice(0, 7)),
      entry?.loading && h('span', { class: 'spinner', 'aria-label': 'Scanning' }),
      entry && removeButton(entry, scan.repository.id)),
    renderWarnings(scan.warnings),
    skills.length > 0
      ? h('div', { class: 'grid' }, skills.map(renderCard))
      : h('p', { class: 'muted' }, scan.skills.length ? 'No skill matches the filter.' : 'No skills in this repository.'));
}

function removeButton(entry, name) {
  return h('button', { class: 'button button-ghost', type: 'button', onclick: () => remove(entry), title: `Remove ${name}` }, 'Remove');
}

function renderWarnings(warnings) {
  return warnings.length > 0 && h('details', { class: 'alert alert-warn' },
    h('summary', {}, warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`),
    h('ul', {}, warnings.map((warning) => h('li', {}, warning))));
}

/** @param {Skill} skill */
function renderCard(skill) {
  return h('a', { class: 'card', href: `#${encodeURIComponent(skill.id)}`, 'data-skill': skill.id, onclick: () => {
      catalogScroll = scrollY;
      openedFromCatalog = true;
    } },
    h('span', { class: 'card-title' }, skill.name),
    h('span', { class: 'card-text' }, skill.summary || 'No description.'),
    h('span', { class: 'card-path' }, skill.path));
}

function renderSkill(id) {
  const found = findSkill(id);
  const back = h('button', { class: 'button back', type: 'button', onclick: closeSkill }, '← Back to the catalog');
  if (!found) {
    const loading = entries.some((entry) => entry.loading);
    $('skill-view').replaceChildren(back,
      h('div', { class: 'empty' }, loading
        ? h('p', {}, h('span', { class: 'spinner' }), ' Scanning…')
        : h('p', { class: 'empty-title' }, `${id} is not in the catalog`)));
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
          h('dt', {}, 'SKILL.md'), h('dd', {}, h('a', { href: skill.link, target: '_blank', rel: 'noopener noreferrer', 'data-link': '' }, 'Open on GitHub ↗')),
          skill.copies.length > 0 && [h('dt', {}, 'Also in'), h('dd', {}, h('ul', {}, skill.copies.map((copy) => h('li', {}, h('code', {}, copy)))))],
          properties.map(([key, value]) => [h('dt', {}, key), h('dd', {}, formatValue(value))])))));
  scrollTo(0, 0);
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
$('filter').addEventListener('input', (event) => {
  filter = event.target.value.trim().toLowerCase();
  renderCatalog();
});
document.querySelector('[data-home]').addEventListener('click', (event) => {
  event.preventDefault();
  if (openSkillId()) closeSkill();
});
addEventListener('hashchange', () => {
  const wasOpen = !$('skill-view').hidden;
  render();
  if (wasOpen && !openSkillId()) {
    openedFromCatalog = false;
    scrollTo(0, catalogScroll);
  }
});

for (const input of new URLSearchParams(location.search).getAll('repo')) scan(input);
render();
