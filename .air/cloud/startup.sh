#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../.."
ROOT=$PWD
STATE="$HOME/.cache/skill-atlas-air"
mkdir -p "$STATE"
if [[ ${AIR_STARTUP_MODE:-} == warmup ]]; then WARMUP=1; else WARMUP=; fi

# The base environment supplies Node 24, npm, and Docker.
node -e 'if (+process.versions.node.split(".")[0] < 24) throw Error("Skill Atlas needs Node.js 24 or newer")'
DEPS_KEY=$(sha256sum package-lock.json package.json | sha256sum | cut -d' ' -f1)
if [[ ! -d node_modules || ! -f "$STATE/deps-$DEPS_KEY" ]]; then
  echo 'Installing locked Node dependencies...'
  npm ci
  rm -f "$STATE"/deps-*
  touch "$STATE/deps-$DEPS_KEY"
fi
# Node fetch needs explicit opt-in to the environment's outbound proxy.
export NODE_USE_ENV_PROXY=1
printf '%s\n' 'export NODE_USE_ENV_PROXY=1' > "$STATE/shell.sh"
HOOK='[ ! -f "$HOME/.cache/skill-atlas-air/shell.sh" ] || . "$HOME/.cache/skill-atlas-air/shell.sh" # skill-atlas-air'
PROFILE="$HOME/.profile"
for candidate in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [[ -f "$candidate" ]]; then PROFILE=$candidate; break; fi
done
for rc in "$PROFILE" "$HOME/.bashrc"; do
  touch "$rc"
  if ! grep -Fq '# skill-atlas-air' "$rc"; then printf '\n%s\n' "$HOOK" >> "$rc"; fi
done

if [[ -n $WARMUP ]]; then
  echo 'Building the pinned visual-test image and warming Docker layers...'
  docker build --build-arg HTTP_PROXY --build-arg HTTPS_PROXY \
    --build-arg http_proxy="${HTTP_PROXY:-}" --build-arg https_proxy="${HTTPS_PROXY:-}" \
    -t skill-atlas-visual tests/visual
  echo 'Visual-test image ready.'
fi

# The application deliberately binds to loopback and validates Host. Keep that
# behavior intact; this environment-only adapter exposes it through Air on 8080.
cat > "$STATE/preview.mjs" <<'JS'
import http from 'node:http';
const server = http.createServer((req, res) => {
  const upstream = http.request({
    hostname: '127.0.0.1', port: 4173, path: req.url, method: req.method,
    headers: { ...req.headers, host: 'localhost:4173' },
  }, reply => {
    res.writeHead(reply.statusCode, reply.headers);
    reply.pipe(res);
  });
  upstream.on('error', error => {
    console.error(error.message);
    if (!res.headersSent) res.writeHead(502);
    res.end('Skill Atlas is starting');
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});
server.listen(8080, '0.0.0.0', () => console.log('Air preview listening on 8080'));
JS
start_process() {
  local name=$1; shift
  if [[ -f "$STATE/$name.pid" ]] && kill -0 "$(cat "$STATE/$name.pid")" 2>/dev/null; then
    echo "$name already running"
  else
    nohup "$@" > "$STATE/$name.log" 2>&1 < /dev/null &
    echo $! > "$STATE/$name.pid"
  fi
}
start_process catalog node "$ROOT/src/cli.ts" serve --port 4173
start_process preview node "$STATE/preview.mjs"

healthcheck() {
  echo 'Checking TypeScript, integration tests, and the CLI fixture scan...'
  npm run typecheck
  npm test
  node src/cli.ts scan ./fixture
  echo 'Waiting for the catalog through the preview proxy...'
  until node --input-type=module - <<'JS'
import http from 'node:http';
const get = path => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port: 8080, path,
    headers: { host: 'air-preview.example' } }, res => {
    let body = '';
    res.on('data', data => body += data);
    res.on('end', () => resolve({status: res.statusCode, body}));
  }).on('error', reject);
});
const page = await get('/');
if (page.status !== 200 || !page.body.includes('Skill Atlas')) process.exit(1);
const api = await get('/api/scan');
if (api.status !== 400 || !api.body.includes('Paste a GitHub')) process.exit(1);
console.log('Preview HTML: 200, Skill Atlas; scan API validation: 400 as expected.');
JS
  do
    for name in catalog preview; do
      if ! kill -0 "$(cat "$STATE/$name.pid")" 2>/dev/null; then
        cat "$STATE/$name.log" >&2
        return 1
      fi
    done
    echo 'Catalog not ready yet; checking again...'
    sleep 3
  done
  echo 'Development environment ready.'
}
if [[ -n $WARMUP ]]; then healthcheck; fi
