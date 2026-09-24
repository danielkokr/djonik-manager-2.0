#!/usr/bin/env bash
# Djonik adapter deploy for the systemd host (#33, docs/52 §3). Source only — running it is a separately
# authorized deployment. Usage (as root): deploy/deploy.sh <full-commit-sha>
#
# Order matters: build and release-check the new revision BEFORE touching the running process, then one
# `systemctl restart` (stop-with-drain, then start). A failed check leaves the old process serving.
set -euo pipefail

REV="${1:?usage: deploy.sh <full-commit-sha>}"
APP=/opt/djonik/app
cd "$APP"

sudo -u djonik git fetch --quiet origin
sudo -u djonik git checkout --quiet --detach "$REV"
test "$(sudo -u djonik git rev-parse HEAD)" = "$REV"
test -z "$(sudo -u djonik git status --porcelain --untracked-files=no)"

sudo -u djonik npm ci --no-audit --no-fund
sudo -u djonik npm run build

# Read-only: the pinned Agent version of this revision's serving release must attest before cutover.
set -a; . /etc/djonik/djonik.env; set +a
sudo -u djonik --preserve-env=ANTHROPIC_API_KEY node dist/releaseCheck.js

echo "DJONIK_APP_REVISION=$REV" > /etc/djonik/revision.env
chmod 0644 /etc/djonik/revision.env

systemctl restart djonik-telegram
sleep 20
journalctl -u djonik-telegram --since "-2min" --no-pager | grep -E '\[release\] (serving|warning)|\[shutdown\]' || {
  echo "No serving tuple line yet — inspect: journalctl -u djonik-telegram -n 50" >&2
  exit 1
}
