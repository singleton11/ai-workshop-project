#!/usr/bin/env bash
# setup.sh: the recording tools, run in the work dir. Headless Debian/Ubuntu (root or sudo) or macOS
# (Homebrew). Installs ffmpeg, ttyd, VHS, fonts, playwright-core and its Chromium; Node >= 24 must
# be there already. Safe to run again.
set -euo pipefail
VHS_VERSION=${VHS_VERSION:-0.12.1}
TTYD_VERSION=${TTYD_VERSION:-1.7.7}
sudo=$([ "$(id -u)" = 0 ] || echo sudo)

if [ "$(uname)" = Darwin ]; then
  command -v vhs >/dev/null || brew install vhs # brings ttyd and ffmpeg
  command -v ffmpeg >/dev/null || brew install ffmpeg
else
  export DEBIAN_FRONTEND=noninteractive
  $sudo apt-get update -qq
  $sudo apt-get install -y -qq --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates curl >/dev/null
  # ttyd: packaged in Ubuntu 22.04+ and Debian 13+, not Debian 12; else its static build.
  if ! command -v ttyd >/dev/null && ! $sudo apt-get install -y -qq --no-install-recommends ttyd >/dev/null 2>&1; then
    $sudo curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.$(uname -m)"
    $sudo chmod +x /usr/local/bin/ttyd
  fi
  if ! command -v vhs >/dev/null; then
    deb=/tmp/vhs_${VHS_VERSION}.deb
    curl -fsSL -o "$deb" "https://github.com/charmbracelet/vhs/releases/download/v${VHS_VERSION}/vhs_${VHS_VERSION}_$(dpkg --print-architecture).deb"
    $sudo dpkg -i "$deb" >/dev/null
  fi
fi

[ -f package.json ] || npm init -y >/dev/null
npm install --silent --no-audit --no-fund playwright-core
# The browsers go to this user's cache; only the system libraries need root.
npx playwright-core install chromium ffmpeg
if [ "$(uname)" != Darwin ]; then
  # The libraries Chromium needs, and fonts.
  $sudo env PATH="$PATH" npx playwright-core install-deps chromium
  # VHS drives a Chromium of its own, found only at these paths; else it downloads one. Give it Playwright's.
  # Never replaces one that is there, even a broken link.
  found=''
  for browser in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome /usr/bin/google-chrome-stable; do
    if [ -x "$browser" ]; then found=$browser; fi
  done
  if [ -z "$found" ] && [ ! -e /usr/bin/chromium ] && [ ! -L /usr/bin/chromium ]; then
    chrome=$(node -e "console.log(require('playwright-core').chromium.executablePath())")
    $sudo ln -s "$chrome" /usr/bin/chromium
  fi
fi
vhs --version
ffmpeg -version | head -1
