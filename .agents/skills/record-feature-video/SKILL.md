---
name: record-feature-video
description: Record an mp4 demo video of a Skill Atlas feature, headless (no display, no player, often a Linux container). Covers the CLI in a terminal (VHS) and the web catalog (Playwright Chromium), with captions, a visible cursor, before/after against an older commit, and simulated GitHub failures such as a dropped connection or a slow network. Use when asked to "record a video", "make a demo", "screencast" or "show the feature" in this repository.
---

# Record a feature video

Everything happens in a work dir outside the repository. Nothing is shown on a screen: you check the
result through screenshots and a contact sheet that you read as images. The worked example,
[examples/partial-scan/](examples/partial-scan/), is the PR #7 video: "a scan that stops partway
keeps what it read". It has a CLI before/after, then three web steps.

## 1. Pick the story

- What changed: `git log --oneline -10`, `git show --stat <merge>`, and
  `git diff <merge>^1 <merge> -- spec/`. Where it shows: the CLI ([spec/cli.md](../../../spec/cli.md)),
  the web catalog ([spec/web.md](../../../spec/web.md)), or both.
- A behavior change reads best as before/after. "Before" is `<merge>^1`.
- Scan a real public repository with 10 to 20 skills, so the output and the cards look real.
  `https://github.com/anthropics/skills` has 19.
- Write the story as 3 to 5 steps, each with a caption, before scripting anything.

## 2. Work dir and tools

```sh
REPO=$(git rev-parse --show-toplevel); SKILL=$REPO/.agents/skills/record-feature-video
DEMO=/tmp/skill-atlas-demo; mkdir -p $DEMO && cd $DEMO
cp -R $SKILL/scripts/. $SKILL/examples/partial-scan/. .   # the example: start from it, rename freely
./setup.sh                      # ffmpeg, ttyd, VHS, fonts, playwright-core + Chromium; apt or brew
ln -sfn $REPO after
git -C $REPO worktree add --detach $DEMO/before <merge>^1 && ln -sfn $REPO/node_modules before/node_modules
export REPO SKILL_ATLAS_RULES=$DEMO/rules.yaml   # a first scan would print "created …" on camera
node $REPO/src/cli.ts rules --defaults > rules.yaml
export GITHUB_TOKEN=${GITHUB_TOKEN:-$(gh auth token 2>/dev/null)}
if [ "$(id -u)" = 0 ]; then export VHS_NO_SANDBOX=true; fi   # VHS's Chromium refuses root without it
```

Tested end to end, headless, in `node:24-bookworm` (Debian 12, root, arm64) and on macOS.

## 3. GitHub, under control: flaky.mjs

Load it as a preload: `node --import $DEMO/flaky.mjs src/cli.ts …`, or set
`NODE_OPTIONS=--import=$DEMO/flaky.mjs`. Both `skill-atlas` launchers and `startServer` pick it up.

- `DROP_AFTER=n`: the connection drops (`fetch failed (read ECONNRESET)`) after n `SKILL.md` reads.
  The count restarts at each repository scan.
- `DROP_FILE=path`: the same, but n is read from the file, so a running server can be switched
  between takes. The `drop(file, n)` helper in `recorder.mjs` writes the file.
- `LATENCY_MS=ms`: each file read waits, so the cards stream in visibly.
- `RECORD=net.json`, then `REPLAY=net.json`: record once, replay for every take. Retakes then need no
  network and use no rate limit. Record with every version you show, `before/` and `after/`, with no
  drop, because dropped answers are not saved:
  `RECORD=$DEMO/net.json $DEMO/before/skill-atlas scan <url> >/dev/null` (with `NODE_OPTIONS` set as
  above).
- Other failures go in `flaky.mjs` too. For a rate limit, return
  `new Response('{"message":"API rate limit exceeded"}', { status: 403 })`.
- Say on screen that the failure is simulated, in a comment line or a caption.
- Clustering (`scan --cluster`, *Group by topic*) runs `claude -p`. For a take, point
  `SKILL_ATLAS_CLAUDE` at `$DEMO/claude.mjs`: `CLAUDE_RECORD=file` runs the real `claude` and saves
  its answer, `CLAUDE_REPLAY=file` prints it again with no model, and `CLAUDE_DELAY_MS=ms` waits
  first, so *Grouping by topic…* shows. `tests/visual/claude.json` is one for anthropics/skills.

## 4. Terminal: VHS

Edit `cli.tape` and run `vhs cli.tape` to get `cli.mp4`.

- Use 1280×800 and font size 18: the same frame as the web part.
- Do the setup between `Hide` and `Show`. Use comment lines as captions. Use a hidden `clear` between
  parts.
- After each command, `Sleep` for its run time plus about 4 s to read it. Time the command first.
  A scan over the network takes 2 to 3 s.
- Check frames before stitching: `ffmpeg -ss <t> -i cli.mp4 -frames:v 1 f.png`, then read `f.png`.

## 5. Web catalog: Playwright

Edit `web.mjs` and run `node web.mjs` to get `web.webm` and `shot-*.png`. `recorder.mjs` provides:

- `startServer({ env })`: `skill-atlas serve` with `flaky.mjs`. Set `PORT` if 4188 is taken.
- `openRecorder()`: a take with `caption(html, holdMs)`, `scan(url)` (type, click *Scan*, wait until
  no spinner), `click`, `type`, `moveTo(locator, { left })`, `shot(name)`, and `close()`, which saves
  the video.
- Headless video shows no mouse. The cursor and the captions are drawn into the page.
- Read every `shot-*.png` before moving on.

## 6. Stitch, check, hand over

```sh
./stitch.sh out/<feature>.mp4 cli.mp4 web.webm   # 1280×800 H.264, fades; out/<feature>.contact.png
```

- Read the contact sheet as an image. Every caption, output and error must be readable.
- Hand over the path. There is no player, and no `open` on a headless machine. Copy the file to
  wherever the user asked. Report the duration and what each part shows.
- Clean up: `git -C $REPO worktree remove --force $DEMO/before`, then check that `git status` in the
  repository is clean.

## Pitfalls

- `npx playwright-core install` puts the browsers in the current user's cache. Only `install-deps`
  needs root. A browser installed with `sudo` is not found by the user.
- Playwright's `recordVideo` needs Playwright's own ffmpeg (`install ffmpeg`), even when a system
  ffmpeg exists.
- VHS finds Chromium only at `/usr/bin/{chromium,chromium-browser,google-chrome,google-chrome-stable}`.
  Otherwise it downloads one. `setup.sh` links Playwright's Chromium there.
- Without fonts, headless Chromium draws boxes instead of text. `fonts-dejavu-core` covers `·`, `—`,
  `…` and `“”`.
- `#scan-error` is in the page even when it is hidden. Locate visible elements, for example
  `#repositories .alert-error`, or `moveTo` throws.
- Pointing the cursor at the middle of text hides the text. Use `{ left: true }`.
- The page's CSP forbids inline styles, so the recorder uses `bypassCSP`. Never change the app for
  the video.
- Without `GITHUB_TOKEN`, GitHub allows 60 requests an hour, which is a few takes. Use `REPLAY`.
- Record and replay with the same `GITHUB_TOKEN` situation. With a token, files are listed through code
  search; without one, through the tree. These are different URLs, and the ones a replay lacks fail.
