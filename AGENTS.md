# AGENTS.md
## Specs
Read [./spec](spec/) first. Update it with the code.
## Tests
Integration tests for every case in the spec.
## Definition of done
- All tests pass locally
- A demo video of the feature is attached to the pull request as evidence that it works

## Demo
After implementing a feature with a user-visible effect (CLI or web catalog), record a demo with the
[record-feature-video](.agents/skills/record-feature-video/SKILL.md) skill and attach it to the PR:
- Record against the feature branch; show before/after (`<base>` vs. branch) for behavior changes.
- Read `out/<feature>.contact.png` as an image before publishing: every caption and output readable.
- `gh` cannot upload PR attachments, so publish to the `demo-assets` branch, never to the feature branch:
  ```sh
  git fetch origin demo-assets && git worktree add /tmp/demo-assets origin/demo-assets \
    || git worktree add --orphan -b demo-assets /tmp/demo-assets
  mkdir -p /tmp/demo-assets/pr-<n> && cp out/<feature>.mp4 out/<feature>.contact.png /tmp/demo-assets/pr-<n>/
  git -C /tmp/demo-assets add . && git -C /tmp/demo-assets commit -m "Demo for PR #<n>" \
    && git -C /tmp/demo-assets push origin HEAD:demo-assets
  git worktree remove /tmp/demo-assets
  ```
- Add a `## Demo` section to the PR body (`gh pr edit <n> --body-file …`): the contact sheet inline,
  a link to the mp4, its duration and what each part shows. URLs:
  `https://github.com/<owner>/<repo>/raw/demo-assets/pr-<n>/<file>`.

### Same conditions every time
Every recording, local or CI, uses the same inputs, so two runs of unchanged code give identical frames:
- **Data:** replay the recorded GitHub responses (`flaky.mjs` replay) for a pinned repository and commit;
  fixed rules file, clock, locale, timezone and random seed. No live network on camera.
- **Viewport:** 1280×800, device scale factor 1, same terminal size and font size in VHS.
- **Fonts:** only the fonts in the `tests/visual/Dockerfile` image, pinned by its tag; no host fonts.
- Same OS image, Chromium and VHS versions as CI: record in that image. Baselines come only from CI.

### Demos are tests
Each demo is also a deterministic e2e test in [tests/visual/](tests/visual/README.md):
- Screenshot the key moments: one per caption step, plus every error or empty state shown.
- Add the demo's steps to `tests/visual/` (Playwright spec, VHS tape); CI's `visual` job runs them.
- CI uploads them to Argos, which compares them with the approved baseline of `main`. Any pixel
  difference makes the required `argos` check red, blocking the merge, until a human approves it.
- A human approves changes in the service's side-by-side view (baseline | new | diff). Agents never
  approve or update baselines; they only report what changed and why.
- Approved screenshots on `main` become the new baseline.

### Record every run
Every demo or e2e run, local or CI, passing or failing, keeps its video and screenshots:
- CI uploads them as the `visual-<attempt>` workflow artifact.
- A failing run's video is the first thing to look at when debugging it.

## Commands
- `npm ci`: first, in a fresh checkout
- `npm test`: the tests
- `npm run test:e2e`: real repositories against snapshots; `npm run test:e2e:update` rewrites them
- `npm run test:visual`: the demos as visual tests, in Docker; `tests/visual/screenshots/` and `results/`
