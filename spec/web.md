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
  *first sentence*, its repository and its path. Sorted by name, then path, as in the CLI.
- More URLs add more repositories; the catalog holds them all, grouped by repository, with the
  number of skills and the scanned commit. Scanning a repository again replaces its skills.
  Each repository can be removed.
- A filter box narrows the cards by name, description or path, in any letter case.
- An organization is **one entry**: its name, `N skills in M of K repositories`, its warnings, then
  each repository with skills, as above, inside it. It is removed as a whole, and scanning it again
  replaces it. A repository of it scanned on its own as well is another entry.
- Skills are added **as each one is read**, not once the scan is done. A repository shows with its
  commit as soon as its files are listed, then each skill, sorted, as soon as it is certain: its
  `SKILL.md` and every path shorter than it (or as long, sorting before it) are read, so it is not
  a copy of another one. Its id, name and main path don't change later. Its `also in` copies and the
  repository's warnings come at the end.
- An organization's repositories are added the same way, each as soon as its first skill is read:
  kept in the organization's order whichever finishes first, its totals counting what is in so far, with
  `scanned N of M` while it goes on. Its warnings come at the end. A repository of it that fails on
  the way is taken out again and becomes one of its warnings, as in the CLI.
- **The page is all there while scans go on**: *Scan* takes more URLs (one being scanned already is
  not scanned twice), the filter works, cards open, *Back* returns, and *Remove* takes an entry out
  and stops its scan. A skill open in the address shows as soon as it is in. An entry is in the
  address as soon as it shows, so a card opened while the scan goes on can be reloaded or shared.
  When the catalog is drawn again, open warnings stay open and the focused card keeps the focus.
  When a scan finishes, an open skill gets its copies and stays scrolled where it was.
- If a scan stops on the way (rate limit, a rejected token, no network: it stops the CLI's too;
  for a repository, also any file that cannot be read), what it added is taken out again: the error
  is shown under the input, the catalog as it was.
- Warnings are shown with their repository, or their organization; an error (not found, rate limit,
  not a URL) is shown under the input, and the catalog is left as it was.

## A skill

Clicking a card opens it: the name, the whole description, the link to the `SKILL.md`
at the scanned commit, the path, `also in` its copies, the other front matter keys, and the body
rendered as Markdown. *Back* returns to the catalog.

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
`200 { source, ref, repository, skills: [{ id, name, description, summary, path, link, commit, copies, properties, html }], warnings }`.
`source` is `https://github.com/<owner>/<repo>[/tree/<ref>]`, whatever way the URL was written: the
same `source` is the same repository in the catalog. `summary` is the description's first sentence;
`html`, the body, made safe as above.
An organization's URL → `200 { source, owner: { id, url }, listed, repositories: [<as above, each>], warnings }`,
`source` being `https://github.com/<owner>`; `repositories`, those with skills; `warnings`, those
of the organization and its other repositories, `<owner>/<repo>: <warning>`.
With `Accept: application/x-ndjson` (the page asks so), the answer comes a line at a time, a JSON
object on each.
- A repository: `{ type: "opened", source, ref, repository }` once its files are listed;
  `{ type: "skill", skill }` for each skill as soon as it is certain (as above, with `copies: []`),
  shortest path first; then `{ type: "done", scan }`, `scan` the answer without the header.
- An organization: `{ type: "organization", source, owner, listed, scanning }` once its
  repositories are listed (`scanning`: how many will be scanned); `{ type: "skill", index, source, ref, repository, skill }`
  for each skill of a repository as it is read, as for a repository; `{ type: "repository", index, repository }`
  for each repository as it is done, in the order they finish, `index` its place among the `scanning`
  ones and `repository` its answer as above, left out if it has no skills or failed (its skills
  heard of before are not in it); then `{ type: "done", warnings }`.

A failure after the first line is the last line, `{ type: "error", error }`, with the CLI's message;
before it, the status and body are as without the header.
A page that goes away before its answer is done (*Remove* on an entry being scanned, a closed tab)
stops the scan on the server too: nothing more is asked of GitHub for it, the requests under way are
cancelled, and no repository of an organization still waiting its turn is opened.
A bad or missing URL, or a local path → `400 { error }`; any other failure the CLI explains
(not found, rate limit, broken rules file) → `422 { error }`, with the CLI's message.
