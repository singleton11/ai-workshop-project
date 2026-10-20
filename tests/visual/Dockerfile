# The one machine visual tests run on, locally and on CI: same OS, Chromium, fonts, VHS.
# Baselines come from CI (linux/amd64) only; a local run, maybe arm64, is for checking, not for Argos.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
ARG VHS_VERSION=0.12.1
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends ffmpeg ttyd fonts-dejavu-core \
 && curl -fsSL -o /tmp/vhs.deb "https://github.com/charmbracelet/vhs/releases/download/v${VHS_VERSION}/vhs_${VHS_VERSION}_$(dpkg --print-architecture).deb" \
 && dpkg -i /tmp/vhs.deb && rm /tmp/vhs.deb \
 && ln -s "$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome | head -1)" /usr/bin/chromium \
 && rm -rf /var/lib/apt/lists/*
# VHS's Chromium refuses root without it. No token: the replay was recorded without one.
ENV VHS_NO_SANDBOX=true TZ=UTC LANG=C.UTF-8 GITHUB_TOKEN=
WORKDIR /work
