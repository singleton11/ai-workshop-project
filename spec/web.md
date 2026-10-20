# Web interface

`./skill-atlas serve [--port <n>]`: a page at `http://localhost:<n>/` (default port 4173), served
from this checkout. Another thin client: the same core, the same [rules](rules.md) file
(created on the first scan, as with `scan`), the same `GITHUB_TOKEN`, kept on the server.
It listens on `127.0.0.1` only, and answers 403 to a `Host` other than `localhost` or `127.0.0.1`. A port in use → a clear message, exit code 1.

## The catalog

- One input: paste a **GitHub repository** URL (`…/tree/<ref>` too) and press *Scan*.
  A local directory is not accepted here: the page is for links.
- The repository's skills fill the **catalog**: a card per skill with its name, its description's
  *first sentence*, its repository and its path. Sorted by name, then path, as in the CLI.
- More URLs add more repositories; the catalog holds them all, grouped by repository, with the
  number of skills and the scanned commit. Scanning a repository again replaces its skills.
  Each repository can be removed.
- A filter box narrows the cards by name, description or path, in any letter case.
- Warnings are shown with their repository; an error (not found, rate limit, not a URL) is shown
  under the input, and the catalog is left as it was.

## A skill

Clicking a card opens it: the name, the whole description, the link to the `SKILL.md`
at the scanned commit, the path, `also in` its copies, the other front matter keys, and the body
rendered as Markdown. *Back* returns to the catalog.

The body comes from someone else's repository: raw HTML in it is shown as text, links other than
`http(s):`, `mailto:` and relative ones are dropped, and the page allows no inline script.
Relative links and images resolve against the `SKILL.md` on GitHub at the scanned commit.

## Nothing is stored

The scanned URLs are in the page's address (`?repo=<url>&repo=<url>`, the open skill as
`#<skill id>`), so a reload or a shared link scans them again. The server keeps no result.

## API

`GET /api/scan?url=<GitHub URL>` →
`200 { source, ref, repository, skills: [{ id, name, description, summary, path, link, commit, copies, properties, html }], warnings }`.
`source` is `https://github.com/<owner>/<repo>[/tree/<ref>]`, whatever way the URL was written: the
same `source` is the same repository in the catalog. `summary` is the description's first sentence;
`html`, the body, made safe as above.
A bad or missing URL, or a local path → `400 { error }`; any other failure the CLI explains
(not found, rate limit, broken rules file) → `422 { error }`, with the CLI's message.
