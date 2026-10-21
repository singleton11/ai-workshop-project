# Visual tests: demos as tests

Each demo's key moments are screenshots. Argos compares them with the approved baseline and a
human approves any difference side by side.

- `partial-scan.spec.ts`, `last-updated.spec.ts`, `nicer-list.spec.ts`, `clustering.spec.ts`, `narrow-skill.spec.ts`: the web
  demos (Playwright). `shot()` is a key moment. `narrow-skill.spec.ts` runs on a phone's screen, 375×667.
- `cli.tape`, `last-updated.tape`, `nicer-list.tape`, `clustering.tape`: the CLI demos (VHS). `Screenshot` is a key moment.
- `net.json`: GitHub's answers, replayed by `flaky.mjs`; no network. Recorded without a token.
  Each skill's date is one more answer: `…/commits?sha=<commit>&path=<file>&per_page=1`.
  Record again: `env -u GITHUB_TOKEN RECORD=$PWD/tests/visual/net.json node --import ./.agents/skills/record-feature-video/scripts/flaky.mjs src/cli.ts scan <url>`.
- `claude.json`: the model's answer for clustering anthropics/skills (`claude -p --model haiku`),
  replayed by `.agents/skills/record-feature-video/scripts/claude.mjs` whatever the question: no model.
  Record again: `SKILL_ATLAS_CLAUDE=$PWD/.agents/skills/record-feature-video/scripts/claude.mjs CLAUDE_RECORD=/tmp/claude.json`
  with the `scan --cluster` above, then keep `type`, `subtype`, `is_error` and `result`.
- `rules.yaml`: the rules, fixed. `Dockerfile`: the one machine (OS, Chromium, fonts, VHS).

## Run

`npm run test:visual` builds the image and runs `run.sh` in it. Out:
`screenshots/` (what Argos compares) and `results/` (a video of every run, traces of failures).
Two runs of unchanged code give byte-identical screenshots.

Baselines come only from CI, on linux/amd64. A local run (arm64 on a Mac) is for checking, never
for Argos; amd64 under emulation crashes Chromium.

## CI and approval

The `visual` job in `.github/workflows/ci.yml` runs on pull requests and on `main`:

1. `npm run test:visual`: fails on a broken step (an element missing, a URL not in `net.json`).
2. Videos and screenshots go up as the `visual-<attempt>` artifact, pass or fail.
3. `argos upload` makes a build. Argos compares it with the latest build of `main` and sets the
   `argos` check on the commit: red while a screenshot differs, green when there is no difference or
   once a human approves the build on argos-ci.com (baseline | new | diff).
4. After the merge, the build on `main` is the new baseline.

The `argos` check is required on `main`, so an unapproved difference blocks the merge. Agents never
approve builds; they report what changed and why.

## One-time setup

1. On argos-ci.com, sign in with GitHub, create a project for this repository and install the
   Argos GitHub app on it. In the project settings, enable tokenless GitHub Actions authentication.
2. Require the checks on `main`, after the first build has reported:
   ```sh
   gh api -X POST repos/singleton11/ai-workshop-project/rulesets --input - <<'JSON'
   {"name": "main", "target": "branch", "enforcement": "active",
    "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
    "rules": [{"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": false,
      "required_status_checks": [{"context": "test"}, {"context": "visual"}, {"context": "argos"}]}}]}
   JSON
   ```
