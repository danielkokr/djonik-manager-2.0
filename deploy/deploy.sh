#!/usr/bin/env bash
# Djonik adapter deploy for the systemd host (#33, docs/52 §3). Source only — running it is a separately
# authorized deployment. Usage (as root): deploy/deploy.sh <full-commit-sha>
#
# Order matters: build and release-check the new revision BEFORE touching the running process, then one
# `systemctl restart` (stop-with-drain, then start). A failed check leaves the old process serving.
set -euo pipefail

# The whole body is one function, parsed completely before it runs: the checkout below replaces this very
# file, and bash reads a plain script incrementally while executing it.
main() {
  local REV="${1:?usage: deploy.sh <full-commit-sha>}"
  local APP=/opt/djonik/app
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

  # The host's DJONIK_EXPECTED_RELEASE must name the release this revision serves. Checked here, before the
  # restart: the new process would refuse it with exit 78 only AFTER the old one had stopped (docs/54 §16).
  local serves
  serves="$(sudo -u djonik node --input-type=module -e 'const m = await import("./dist/release.js"); console.log(m.SERVING_RELEASE.id);')"
  if [ -n "${DJONIK_EXPECTED_RELEASE:-}" ] && [ "$DJONIK_EXPECTED_RELEASE" != "$serves" ]; then
    echo "Revision $REV serves $serves but /etc/djonik/djonik.env has DJONIK_EXPECTED_RELEASE=$DJONIK_EXPECTED_RELEASE." >&2
    echo "Set DJONIK_EXPECTED_RELEASE=$serves there first (docs/52 §6). The running process was not touched." >&2
    exit 1
  fi

  echo "DJONIK_APP_REVISION=$REV" > /etc/djonik/revision.env
  chmod 0644 /etc/djonik/revision.env

  local since
  since="$(date +%s)"
  # Enabling only survives reboots; it starts nothing. The one restart stops the old process (drain) first.
  systemctl enable --quiet djonik-telegram
  systemctl restart djonik-telegram

  # Success = the NEW process logged its attested serving tuple for exactly this revision. A `[shutdown]`
  # line from the old process, or a new process that exited 78, is not success.
  local waited=0
  until journalctl -u djonik-telegram --since "@$since" --no-pager -o cat | grep -q "\[release\] serving .* app=$REV "; do
    if ! systemctl is-active --quiet djonik-telegram || [ "$waited" -ge 90 ]; then
      journalctl -u djonik-telegram --since "@$since" --no-pager -o cat | grep -E '^\[(release|shutdown)\]' >&2 || true
      echo "Revision $REV is not serving — inspect: journalctl -u djonik-telegram -n 50; rollback: docs/52 §6" >&2
      exit 1
    fi
    sleep 3
    waited=$((waited + 3))
  done
  journalctl -u djonik-telegram --since "@$since" --no-pager -o cat | grep -E '^\[release\] (serving|warning)'
}

main "$@"
exit
