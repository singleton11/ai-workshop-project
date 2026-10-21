# Clustering

Skills grouped by **topic**: what each one helps with. A small model reads them and names the
groups: `claude -p` (Claude Code) with its small model, Haiku. [Issue #17](https://github.com/singleton11/ai-workshop-project/issues/17).
The [CLI](cli.md) does it with `scan --cluster`, the [web catalog](web.md#the-catalog) with *Group by topic*.

## What the model reads

- The skills of one scan, a repository or a whole organization, after `--filter`: one question
  for all of them. No skills, no question.
- Of each skill: its id, name, description and body (the first 1500 characters; a body cut
  there ends in `…`). The page sends the text of its body as shown, without the HTML.
- It is asked for 2 to 8 topics, each a short name in Title Case, every skill in exactly one,
  as JSON: `[{ "topic": "<name>", "skills": ["<id>", …] }]`.

## The answer

- JSON, alone, in a code fence or after a few words: small models add them. Anything else is an
  error: `Clustering failed: the model did not answer with topics: <the start of its answer>`.
- Checked, never trusted: an id the question did not have is dropped, and so is a second mention
  of one; a skill it left out goes to `Other`; topics with the same name (spaces trimmed) are one;
  a topic left empty is gone. So each skill is in exactly one topic.
- Topics: the largest first; on a tie, by name in code-unit order. In a topic, skills by name,
  then id (the CLI) or path (the page).
- The answer is not stored: the same scan clustered again asks again, and the model may group it
  differently.

## Claude Code

- `claude -p --model haiku --output-format json --tools "" --no-session-persistence`, the question
  on stdin: no tools, no session kept. Its answer is the JSON's `result`.
- `SKILL_ATLAS_CLAUDE`: another program to run instead of `claude`, with the same arguments.
- `claude` not found → `Clustering needs Claude Code: claude was not found; install it, or set
  SKILL_ATLAS_CLAUDE`. It fails (a non-zero exit, `is_error`, an answer that is not its JSON) →
  `Clustering failed: claude: <its message>`, the first line of it. Both are errors, exit code 1.
- Only the Node client has it: in the browser terminal, `--cluster` → `--cluster runs only from
  the command line`.
