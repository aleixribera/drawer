#!/usr/bin/env bash
# Ship the committed source to a Docker host over ssh and rebuild it there (Git Bash or any bash): ./scripts/deploy.sh
#
#   1. typecheck and tests, here (never on the server)
#   2. the committed source (git archive HEAD) goes to $DRAWER_STACK/app.new over ssh
#   3. on the server: app becomes app.prev, app.new becomes app, `docker compose up --build --wait`
#   4. a version that doesn't come up healthy is rolled back to app.prev
#
# Settings come from deploy.local.env (git-ignored) next to package.json:
#   DRAWER_SSH          ssh host, e.g. myserver
#   DRAWER_STACK        folder on the server holding compose.yaml and .env (the compose file builds ./app)
#   DRAWER_DATA_DIR     the data folder on the server, made if missing
#   DRAWER_PORT         the port the app answers on at the server's 127.0.0.1 (for the health check), default 3130
#   DRAWER_PUBLIC_URL   printed at the end (optional)
#   DRAWER_STACK_SRC    a local copy of the server's compose.yaml folder; when set, the deploy refuses to run while
#                       they differ (optional)
#   DRAWER_EVENTS       a JSONL file on the server to log deployed / up_failed / rolled_back to (optional)
#
#   ./scripts/deploy.sh --quick       without the typecheck and tests
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f deploy.local.env ]] && . ./deploy.local.env
: "${DRAWER_SSH:?set DRAWER_SSH in deploy.local.env (see the top of this script)}"
: "${DRAWER_STACK:?set DRAWER_STACK in deploy.local.env}"
: "${DRAWER_DATA_DIR:?set DRAWER_DATA_DIR in deploy.local.env}"
HOST="$DRAWER_SSH"
STACK="$DRAWER_STACK"
DATA="$DRAWER_DATA_DIR"
PORT="${DRAWER_PORT:-3130}"
EVENTS="${DRAWER_EVENTS:-}"
ssh_server() { ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" "$@"; }

case "${1:-}" in
  --quick) quick=1 ;;
  "") quick=0 ;;
  *) sed -n '2,20p' "$0" | cut -c3-; exit 2 ;;
esac

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "deploy: commit first; only the committed source is shipped" >&2
  exit 1
fi

if [[ "$quick" == 0 ]]; then
  echo "== typecheck and tests"
  npm run --silent typecheck
  npm test --silent
fi

if [[ -n "${DRAWER_STACK_SRC:-}" ]]; then
  here="$(sha256sum "$DRAWER_STACK_SRC/compose.yaml" | cut -d' ' -f1)"
  there="$(ssh_server "sha256sum $STACK/compose.yaml 2>/dev/null | cut -d' ' -f1" || true)"
  if [[ "$here" != "$there" ]]; then
    echo "deploy: the server's $STACK/compose.yaml is not $DRAWER_STACK_SRC/compose.yaml; push that first." >&2
    exit 1
  fi
fi

commit="$(git rev-parse HEAD)"
echo "== shipping ${commit:0:7}"
ssh_server "mkdir -p $DATA && rm -rf $STACK/app.new && mkdir $STACK/app.new"
git archive --format=tar HEAD | ssh_server "tar -x -C $STACK/app.new && echo $commit > $STACK/app.new/.commit"

echo "== building and starting (a few minutes the first time)"
ssh_server "bash -s" <<EOF
set -uo pipefail
cd $STACK
EVENTS="$EVENTS"
event() { [[ -n "\$EVENTS" ]] || return 0; printf '{"ts":%s,"source":"drawer-deploy","stack":"drawer","event":"%s","commit":"%s"}\n' "\$(date +%s)" "\$1" "${commit:0:12}" >> "\$EVENTS" 2>/dev/null || true; }
rm -rf app.prev
[[ -d app ]] && mv app app.prev
mv app.new app
if docker compose up -d --build --wait --wait-timeout 240 drawer whisper; then
  echo "$commit" > .deployed
  event deployed
  docker image prune -f --filter label=com.docker.compose.project=drawer >/dev/null 2>&1 || true
  exit 0
fi
echo "${commit:0:7} did not come up healthy; rolling back" >&2
docker compose logs --tail 40 drawer >&2 || true
event up_failed
if [[ -d app.prev ]]; then
  rm -rf app && mv app.prev app
  docker compose up -d --build --wait --wait-timeout 240 drawer whisper && event rolled_back
fi
exit 1
EOF

ssh_server "curl -fsS -m 5 http://127.0.0.1:$PORT/health" && echo
echo "Drawer is up${DRAWER_PUBLIC_URL:+: $DRAWER_PUBLIC_URL}"
