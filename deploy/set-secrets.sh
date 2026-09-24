#!/usr/bin/env bash
# Writes the Djonik host secrets file /etc/djonik/djonik.env (root, 0600) without secrets ever appearing
# on screen, in shell history or in a command line (#33, docs/52 §2 and §5).
# Usage (as root):
#   deploy/set-secrets.sh                                   # first setup: asks for every value
#   deploy/set-secrets.sh TRELLO_READ_TOKEN TRELLO_READ_TOKEN_EXPIRES_AT   # rotation: only these, keeps the rest
# Values are read from the terminal; secret ones are not echoed. Then: systemctl restart djonik-telegram.
set -euo pipefail

main() {
  local FILE=/etc/djonik/djonik.env
  local ALL=(ANTHROPIC_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USER_ID TRELLO_API_KEY TRELLO_READ_TOKEN TRELLO_READ_TOKEN_EXPIRES_AT DJONIK_EXPECTED_RELEASE)
  local SECRET=" ANTHROPIC_API_KEY TELEGRAM_BOT_TOKEN TRELLO_API_KEY TRELLO_READ_TOKEN "
  [ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
  local keys=("$@")
  [ "${#keys[@]}" -gt 0 ] || keys=("${ALL[@]}")
  local key known
  for key in "${keys[@]}"; do
    known=0
    for k in "${ALL[@]}"; do [ "$k" = "$key" ] && known=1; done
    [ "$known" = 1 ] || { echo "Unknown key $key. Known: ${ALL[*]}" >&2; exit 2; }
  done

  umask 077
  install -d -m 0700 -o root -g root /etc/djonik
  local tmp
  tmp="$(mktemp /etc/djonik/.djonik.env.XXXXXX)"
  trap 'rm -f "$tmp"' EXIT
  # Keep every existing line except the keys being replaced.
  if [ -f "$FILE" ]; then
    local pattern
    pattern="^($(IFS='|'; echo "${keys[*]}"))="
    grep -Ev "$pattern" "$FILE" > "$tmp" || true
  fi

  local value
  for key in "${keys[@]}"; do
    if [[ "$SECRET" == *" $key "* ]]; then
      read -rsp "$key (hidden): " value; echo
    else
      read -rp "$key: " value
    fi
    # The file is read both by systemd and by `.` in deploy.sh: allow only plain token characters, so no
    # value can be interpreted by a shell.
    [[ "$value" =~ ^[A-Za-z0-9:_.+-]+$ ]] || { echo "$key: empty or contains unsupported characters; nothing written." >&2; exit 1; }
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  done

  chown root:root "$tmp"
  chmod 0600 "$tmp"
  mv -f "$tmp" "$FILE"
  trap - EXIT
  echo "Wrote ${#keys[@]} value(s) to $FILE (root, 0600). Apply with: systemctl restart djonik-telegram"
}

main "$@"
exit
