# Sourced by setup.sh and manage.sh. Ownership: see "Permissions" in docs/operations.md.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../settings.env"

[[ $EUID -eq 0 ]] || { echo "Run this script as root (sudo)." >&2; exit 1; }
[[ "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" == "$APP_DIR" ]] \
  || { echo "The repository must be cloned to $APP_DIR." >&2; exit 1; }
cd "$APP_DIR"

# Read by uv: the Python it downloads goes here, not under /root, which pis can't enter.
export UV_PYTHON_INSTALL_DIR=/opt/uv-python

step() { if [ -t 1 ]; then printf '\n\033[1;36m=====>\033[0m \033[1;35m%s\033[0m\n' "$*"; else printf '\n=====> %s\n' "$*"; fi; }

for lib in deploy/lib/*.sh; do
  [[ $lib == deploy/lib/common.sh ]] || source "$lib"
done
