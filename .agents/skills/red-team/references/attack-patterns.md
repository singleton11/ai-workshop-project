# Attack patterns

Apply them to every surface you test. Each one is a question: *what does [spec/](../../../../spec/)
say should happen, and does it?* Adapted for skill-atlas from Browserbase's
[`adversarial-patterns.md` and `exploratory-testing.md`](https://github.com/browserbase/skills/tree/main/skills/ui-test/references)
(MIT, see [LICENSE.txt](../LICENSE.txt)).

## CLI: `./skill-atlas`

Run offline first: `fixture/` is a local directory with a skill, a skill in another agent's folder,
malformed front matter and more ([fixture/README.md](../../../../fixture/README.md)). Keep stdout,
stderr and `$?` apart: `cmd >out.txt 2>err.txt; echo $?`.

| Attack | Try |
| --- | --- |
| Bad input | no URL, two URLs, `http://` vs `https://`, `github.com/o/r` with no scheme, a trailing `/` or `.git`, `…/blob/…`, `…/tree/` with no ref, `…/tree/<unknown-ref>`, a GitLab URL, an empty string, a 2 KB URL, a URL with `?`, `#`, `%2F`, spaces, unicode |
| Bad flags | `--filter` with no value, `--filter=` vs `--filter ''`, a flag after the URL, a flag twice, `--rules` on a missing / empty / binary / invalid-YAML file, an unknown flag, `--help`, an unknown command |
| Filter | regex characters (`.*`, `[`, `(`), `%`, unicode case (`İ`, `ß`), whitespace only, a text matching only a path |
| Output modes | a TTY vs a pipe (`| cat`) vs a file; `NO_COLOR=` (empty), `TERM=dumb`; a tiny terminal (`stty cols 20`), a huge one; names and descriptions with emoji, RTL text, ANSI escapes or newlines |
| Environment | no `HOME`, a read-only `XDG_CONFIG_HOME`, `SKILL_ATLAS_RULES` pointing at a directory, two first scans at once (`& wait`), no `GITHUB_TOKEN` vs a wrong one |
| Network | with `flaky.mjs` from [record-feature-video](../../record-feature-video/SKILL.md#3-github-under-control-flakymjs): a drop after n files (`DROP_AFTER`), slow reads (`LATENCY_MS`), a 403 rate limit, a 404, a 500, invalid JSON. Does the exit code, the `scan incomplete:` line on stderr and the partial output match [spec/cli.md](../../../../spec/cli.md)? |
| Clustering | `--cluster` with `SKILL_ATLAS_CLAUDE` pointing at a missing binary, one that exits 1, one that prints garbage, or one that hangs ([tests/fake-claude.mjs](../../../../tests/fake-claude.mjs) is a model of a fake) |
| Signals | Ctrl-C (`timeout -s INT 2 …`) mid-scan: a stack trace? a half-written rules file? |

## Server: `./skill-atlas serve`

Check the HTTP contract in [spec/web.md](../../../../spec/web.md#api) with `curl -si`.

- A port in use, `--port 0`, `--port 99999`, `--port abc`.
- `Host: evil.example` (must be 403), `Host: localhost:1`, no `Host`.
- `GET /api/scan` with no `url`, an empty one, a local path, a non-GitHub URL (400), an unknown
  owner (422), with and without `Accept: application/x-ndjson`; close the connection mid-stream
  (`curl --max-time 1`): does the server keep scanning, or crash?
- `POST /api/cluster`: `GET` (405), `text/plain` (415), `{}`, `{skills: "x"}`, duplicate ids (400),
  9 MiB (413), a model that fails (422).
- Paths: `/../package.json`, `/%2e%2e/`, `/public/../src/cli.ts`, a 404.

## Web catalog

Drive it with [scripts/probe.mjs](../scripts/probe.mjs); read every screenshot and `log.txt`.
Ids: `#scan-url`, `#scan-button`, `#scan-error`, `#filter`, `#count`, `#group`, `#group-error`,
`#repositories`, `#skill-view`, `.spinner`. `#scan-error` exists even when hidden: locate visible
elements (`#scan-error:not([hidden])`).

- **Forms:** submit empty; submit the same URL twice quickly; paste 500 characters; paste a URL
  with spaces around it; press Enter vs clicking *Scan*; scan while another scan is running.
- **Hostile content:** a skill body with `<script>`, `<img onerror>`, `javascript:` links,
  `data:` images, a 10 000-line body, very long names with no spaces. The body must be text, not
  HTML ([spec/web.md](../../../../spec/web.md#a-skill)); check `log.txt` for CSP violations.
- **State and address:** reload mid-scan; open a card mid-scan and reload; *Back* and the browser's
  back button; a hand-edited `?repo=` (garbage, duplicated, 50 of them); a `#skill=` that does not
  exist; *Remove* during a scan (the server must stop it: watch its log).
- **Filter and topics:** type while cards stream in; filter to zero; *Group by topic* then *Remove*,
  then a new scan, then reload; press it twice quickly; with a failing model.
- **Keyboard:** Tab through the whole page: every control reachable, the focus visible, the order
  logical; Enter opens a card; Escape and *Back*; the focus after the catalog is redrawn.
- **Layout:** 375×667 (mobile), 1920×1080, 200 % zoom; long paths in chips; an organization with
  many repositories.
- **Errors:** every message under the input says what is wrong and keeps what was typed; the
  catalog is left as it was.

## What counts as a bug

- The behavior differs from the spec: a wrong exit code, message, order, count, stream or status.
- A crash, a stack trace, a hang, an unhandled rejection, a console error, a leaked process.
- Unsafe: script runs, an outside `Host` is answered, a file outside `public/` is served.
- Lost work: typed input cleared, a catalog emptied by an error.
- Confusing: a message that does not say what to do, a dead end, an unreachable control.

Not a bug: a behavior the spec states on purpose, even if you would design it differently.
That is an `enhancement`, filed only if the user asked for them.
