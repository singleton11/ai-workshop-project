# Issue template

One issue per bug. The title is the symptom, short and specific, in the user's words:
`scan exits 0 when the ref does not exist`, not `Bug in parse.ts`. The body, written to a file
and passed with `--body-file`:

````markdown
## What happens

<one or two sentences: the observed behavior>

## What should happen

<the expected behavior, quoting the spec line that says so>
([spec/<file>.md](https://github.com/<owner>/<repo>/blob/<commit>/spec/<file>.md#<anchor>))

## Steps to reproduce

At <commit>, after `npm ci`:

```sh
<the smallest commands that show it, each one copy-pasteable; for the web, the URL and the clicks>
```

Output:

```
<stdout / stderr / exit code / HTTP status, trimmed to what matters>
```

Reproduced <n> of <n> times. <Environment if it matters: no GITHUB_TOKEN, NO_COLOR, viewport.>

## Evidence

<screenshots and video, for the web: link them from the `red-team` branch, see SKILL.md>

## Severity

<critical | high | medium | low>: <why, in one line>

---
Found by the [red-team](https://github.com/<owner>/<repo>/blob/main/.agents/skills/red-team/SKILL.md) skill.
````

## Severity

| Level | Means |
| --- | --- |
| critical | unsafe (script runs, files or other hosts served), or a crash that loses data or hangs |
| high | a core flow (scan, filter, open a skill) is broken or gives a wrong result |
| medium | a spec'd edge case is wrong: an exit code, a message, an order, a status |
| low | cosmetic, or a confusing message where the behavior is right |

## Rules

- No guesses about the cause in *What happens*. If you know the cause (you may read the code
  once a bug is confirmed), add a short `## Likely cause` with `file:line`, marked as a guess.
- One bug per issue. Two symptoms with one cause: one issue that lists both.
- Never paste a token, a home path or anything from `~/.config` other than the rules file.
