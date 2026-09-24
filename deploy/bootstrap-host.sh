#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 LTS VM as the Djonik host (#33, docs/52 §2, docs/54 §6–7).
# Usage (as root, once): bash bootstrap-host.sh
#
# Installs Node.js LTS and git, creates the service user `djonik`, clones the public repository to
# /opt/djonik/app, creates the root-only secrets directory, installs (but neither enables nor starts) the
# systemd unit, allows no inbound traffic except SSH, and makes SSH key-only. Re-running is safe.
# It writes no secret and starts no poller: secrets come from deploy/set-secrets.sh, the first start from
# deploy/deploy.sh.
set -euo pipefail

main() {
  local REPO_URL=https://github.com/danielkokr/djonik-manager-2.0
  local NODE_MAJOR=24
  [ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
  . /etc/os-release
  [ "$ID" = ubuntu ] || echo "Warning: written and checked for Ubuntu 24.04 LTS; this is $PRETTY_NAME." >&2

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg git unattended-upgrades ufw

  # Security updates install by themselves (the Ubuntu default, made explicit).
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

  # Node.js LTS from NodeSource's signed apt repository: /usr/bin/node is the unit's ExecStart, and
  # unattended-upgrades keeps it patched within the major line.
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'
  grep -q 'nodesource' /etc/apt/apt.conf.d/52djonik-node-updates 2>/dev/null ||
    echo 'Unattended-Upgrade::Origins-Pattern:: "site=deb.nodesource.com";' > /etc/apt/apt.conf.d/52djonik-node-updates

  # Service user: no login shell; its home holds the checkout and the npm cache.
  id djonik >/dev/null 2>&1 || useradd --system --home-dir /opt/djonik --create-home --shell /usr/sbin/nologin djonik
  [ -d /opt/djonik/app/.git ] || sudo -u djonik git clone --quiet "$REPO_URL" /opt/djonik/app

  # Secrets live only here: root-owned directory, files 0600 (deploy/set-secrets.sh).
  install -d -m 0700 -o root -g root /etc/djonik

  # One unit, installed but not enabled/started: the first `deploy/deploy.sh <sha>` enables and starts it.
  install -m 0644 /opt/djonik/app/deploy/djonik-telegram.service /etc/systemd/system/djonik-telegram.service
  systemctl daemon-reload

  # The adapter needs outbound HTTPS only (Telegram long polling, Anthropic, Trello): no inbound port but SSH.
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow OpenSSH
  ufw --force enable

  # SSH: keys only. Skipped (with a warning) when root has no authorized key, so this cannot lock you out.
  if [ -s /root/.ssh/authorized_keys ]; then
    printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/10-djonik.conf
    sshd -t
    systemctl reload ssh.service 2>/dev/null || systemctl restart ssh.service
  else
    echo "Warning: /root/.ssh/authorized_keys is empty; SSH password login left unchanged. Add a key, then re-run." >&2
  fi

  echo "Host prepared: node $(node --version), repo at /opt/djonik/app, unit installed (not started)."
  echo "Next: bash /opt/djonik/app/deploy/set-secrets.sh, then /opt/djonik/app/deploy/deploy.sh <full-commit-sha> (docs/52 §3)."
}

main "$@"
exit
