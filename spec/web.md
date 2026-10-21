# Web interface

`./skill-atlas serve [--port <n>]`: a page at `http://localhost:<n>/` (default port 4173), served
from this checkout. Another thin client: the same core, the same [rules](rules.md) file
(created on the first scan, as with `scan`), the same `GITHUB_TOKEN`, kept on the server.
It listens on `127.0.0.1` only, and answers 403 to a `Host` other than `localhost` or `127.0.0.1`. A port in use → a clear message, exit code 1.

## The catalog

- One input: paste a **GitHub repository** URL (`…/tree/<ref>` too), or an **organization**'s
  (`https://github.com/<owner>`, [what is scanned](analysis.md#an-organization)), and press *Scan*.
  A local directory is not accepted here: the page is for links.
- The repository's skills fill the **catalog**: a card per skill with its name, its description's
  *first sentence*, its repository, its path and `Updated <YYYY-MM-DD>`: the day it
  [last changed](analysis.md#details), in UTC, the whole time on hover; no date, no such line.
  Sorted by name, then path, as in the CLI.
- A card: the name, with `Updated <YYYY-MM-DD>` on the same line; the first sentence, cut to three
  lines, all of it on hover; the path in a chip, cut with `…` if it does not fit, all of it on hover.
  The repository's heading, its number of skills and its commit sit above a line over its cards.
- More URLs add more repositories; the catalog holds them all, grouped by repository, with the
  number of skills and the scanned commit. Scanning a repository again replaces its skills.
  Each repository can be removed.
- A filter box narrows the cards by name, description or path, in any letter case.
- **Group by topic**, next to the filter, groups the catalog's cards by topic instead of by
  repository: a small model names the topics ([clustering](clustering.md)). Each topic shows its
  name, `N skills` and its cards, the largest first; each card also names its repository. Every
  skill in the catalog is sent once: a skill in two entries is in the first one. While the server
  asks the model, the button says `Grouping by topic…`; then *Show by repository* goes back. The
  filter narrows the cards in each topic too; a topic with none left is hidden. It can be pressed only while no scan is going on; a
  new scan or *Remove* puts the catalog back by repository, as the topics were those of the catalog
  before. A failure is an error under the filter, and the catalog stays by repository. The topics
  are not in the address: a reload shows the catalog by repository.
- An organization is **one entry**: its name, `N skills in M of K repositories`, its warnings, then
  each repository with skills, as above, inside it. It is removed as a whole, and scanning it again
  replaces it. A repository of it scanned on its own as well is another entry.
- Skills are added **as each one is read**, not once the scan is done. A repository shows with its
  commit as soon as its files are listed, then each skill, sorted, as soon as it is certain: its
  `SKILL.md` and every path shorter than it (or as long, sorting before it) are read, so it is not
  a copy of another one, and its date is read. Its id, name, main path and date don't change later.
  Its `also in` copies and the repository's warnings come at the end.
- An organization shows **how far it has got** from the start. Before any repository is scanned,
  GitHub lists them 100 at a time, and code search (with `GITHUB_TOKEN`) finds their `SKILL.md` files
  100 at a time; on a large organization that takes a while. So, as soon as the owner is found, the
  entry shows its name, `Listing its repositories… N repositories so far` and a bar that moves
  without a total; then `N repositories listed. Searching them for SKILL.md files… F of T found`,
  with a bar at `F` of `T`. Its totals come once the scan starts.
- An organization's repositories are added the same way, each as soon as its first skill is read:
  kept in the organization's order whichever finishes first, its totals counting what is in so far, with
  `scanned N of M` and a bar at `N` of `M` while it goes on. Its warnings come at the end. A
  repository that cannot be opened is skipped with a warning; one that stops partway keeps its
  partial result and error.
- **The page is all there while scans go on**: *Scan* takes more URLs (one being scanned already is
  not scanned twice), the filter works, cards open, *Back* returns, and *Remove* takes an entry out
  and stops its scan. A skill open in the address shows as soon as it is in. An entry is in the
  address as soon as it shows, so a card opened while the scan goes on can be reloaded or shared.
  When the catalog is drawn again, open warnings stay open and the focused card keeps the focus.
  When a scan finishes, an open skill gets its copies and stays scrolled where it was.
- Warnings are shown with their repository, or their organization; an error (not found, rate limit,
  not a URL) is shown under the input, and the catalog is left as it was.
- A scan that stopped partway ([analysis](analysis.md#details)) keeps the skills and warnings read
  before the error. A new repository shows those skills and `Scan incomplete: <message>` with them.
  An existing repository keeps its earlier skills; the error is shown under the input,
  `Scan incomplete: <message>; <owner>/<repo> is left as it was`.
- If an organization repository stops partway, its skills read before the error stay in that
  repository with `Scan incomplete: <message>`; the other repositories continue as usual.

## A skill

Clicking a card opens it: the name, the whole description, the link to the `SKILL.md`
at the scanned commit, the path, *Updated* (the day it last changed, if known), `also in` its
copies, the other front matter keys, and the body rendered as Markdown. *Back* returns to the catalog.
The view fits the window, a phone's too (375 px wide): long words in the name and the description
wrap, and a table or code block wider than the body scrolls sideways in its own box, not the page.

The body comes from someone else's repository: raw HTML in it is shown as text, links other than
`http(s):`, `mailto:` and relative ones are dropped, and the page allows no inline script.
Relative links and images resolve against the `SKILL.md` on GitHub at the scanned commit;
root-relative ones (`/docs/x.md`), against the repository root at that commit, as on GitHub.

## Nothing is stored

The scanned URLs are in the page's address (`?repo=<url>&repo=<url>`, the open skill as
`#in=<source>&skill=<skill id>`), so a reload or a shared link scans them again. The server keeps no result.
`<source>` is the catalog entry the card was in: the same skill can be in two entries at two
commits (an organization and one of its repositories on its own, or a repository at two refs), and
each card opens its own. A bare `#<skill id>` opens its first copy in the catalog.

## API

`GET /api/scan?url=<GitHub URL>` →
`200 { source, ref, repository, skills: [{ id, name, description, summary, path, link, commit, updated, copies, properties, html }], warnings, error? }`;
`error` only when the scan stopped partway: the skills are those read before it.
`source` is `https://github.com/<owner>/<repo>[/tree/<ref>]`, whatever way the URL was written: the
same `source` is the same repository in the catalog. `summary` is the description's first sentence;
`html`, the body, made safe as above; `updated`, when it last changed, ISO 8601 in UTC, or `""`.
An organization's URL → `200 { source, owner: { id, url }, listed, repositories: [<as above, each>], warnings }`,
`source` being `https://github.com/<owner>`; `repositories`, those with skills; `warnings`, those
of the organization and its other repositories, `<owner>/<repo>: <warning>`.
With `Accept: application/x-ndjson` (the page asks so), the answer comes a line at a time, a JSON
object on each.
- A repository: `{ type: "opened", source, ref, repository }` once its files are listed;
  `{ type: "skill", skill }` for each skill as soon as it is certain and its date is read (as above,
  with `copies: []`), shortest path first: a skill waits for the dates of those before it; then
  `{ type: "done", scan }`, `scan` the answer without the header.
- An organization: `{ type: "listing", source, owner, repositories, search? }` while its
  repositories are listed: once the owner is found (`repositories: 0`), after each page of
  repositories (`repositories`: listed so far, forks and archived ones left out), then after each page
  of code search (`search: { found, total }`: the `SKILL.md` files found so far, of the total GitHub
  says it has); then `{ type: "organization", source, owner, listed, scanning }` once its
  repositories are listed (`scanning`: how many will be scanned); `{ type: "skill", index, source, ref, repository, skill }`
  for each skill of a repository as it is read, as for a repository; `{ type: "repository", index, repository }`
  for each repository as it is done, in the order they finish, `index` its place among the `scanning`
  ones and `repository` its answer as above, left out if it has no skills or failed (its skills
  heard of before are not in it); then `{ type: "done", warnings }`.

A failure that can be kept as a partial scan is returned in the usual result: its `error` is the
first failure, and its skills are the ones read before it. A failure that stops the whole scan is
the last line, `{ type: "error", error }`, with the CLI's message; before the first line, the
status and body are as without the header (an unknown owner is still a `422`). An organization's
first line is out once its owner is found, so a failure listing its repositories is a line too.
A page that goes away before its answer is done (*Remove* on an entry being scanned, a closed tab)
stops the scan on the server too: nothing more is asked of GitHub for it, the requests under way are
cancelled, and no repository of an organization still waiting its turn is opened. Only that scan
stops: the server goes on, and so do the other pages' scans, even when skills' dates are being read.
A bad or missing URL, or a local path → `400 { error }`; any other failure the CLI explains
(not found, rate limit, broken rules file) → `422 { error }`, with the CLI's message.

`POST /api/cluster`, with `Content-Type: application/json` and `{ skills: [{ id, name, description, body }] }`
(each a string, each id once) → `200 { clusters: [{ topic, skills: [<id>] }] }`: the
[clustering](clustering.md#the-answer), largest topic first. JSON only, so that a page elsewhere
cannot send it without asking first (CORS), which this server never allows: another
`Content-Type` → `415`. Not a `POST` → `405`; a body of another shape → `400 { error }`; over 8 MiB
→ `413`. Clustering that fails → `422 { error }`, with the CLI's message. A page that goes away
before the answer stops the model's process.
