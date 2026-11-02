#!/usr/bin/env bash
# First-time setup of a fresh Debian/Ubuntu server; safe to run again. See docs/deployment.md.
#
#   sudo /srv/pythonsupport-survey/deploy/setup.sh psqdb.compute.dtu.dk
#   sudo /srv/pythonsupport-survey/deploy/setup.sh --test [host]    # never in production
#
# Test mode has no nginx: gunicorn serves plain HTTP to any machine, with DEBUG=1 because the
# HTTPS-only session cookie would make logging in impossible.
set -euo pipefail
USAGE="usage: setup.sh <domain>  |  setup.sh --test [host]"
if [[ ${1:-} == --test ]]; then
  TEST_MODE=1
  DOMAIN=${2:-localhost}
else
  TEST_MODE=
  DOMAIN=${1:?$USAGE}
fi
source "$(dirname "$0")/lib/common.sh"
if [[ -n $TEST_MODE ]]; then URL=http://$DOMAIN:$PORT; else URL=https://$DOMAIN; fi

test_mode_warning() {
  local on='' off=''
  [ -t 1 ] && { on='\033[1;31m'; off='\033[0m'; }
  printf "\n${on}!!! TEST MODE: plain HTTP, DEBUG=1, and gunicorn reachable from other machines.${off}\n"
  printf "${on}!!! Do not use this setup in production. Run setup.sh <domain> on the real server.${off}\n"
}
[[ -z $TEST_MODE ]] || test_mode_warning

step "System packages";                  install_packages
step "uv";                               install_uv
step "Service user '$APP_USER'";         create_system_user "$APP_USER"
step "Shared checkout (group '$DEV_GROUP')"; share_checkout
# Straight after share_checkout, which opens up an existing backend/.env along with the checkout.
step "Settings (backend/.env)";          write_env_file
step "PostgreSQL database";              setup_database
step "PostgreSQL password logins (PAM)"; setup_pam_auth
step "Python dependencies";              sync_deps

step "Database and static files"
manage_as "$APP_USER" migrate
manage_as root collectstatic --no-input

# After migrate, so the rights cover Django's tables.
step "Database rights (deploy/db-permissions.sql)"; apply_db_permissions
step "Notebook access for the '$DEV_GROUP' group";  sync_db_users
step "Notebook pipeline (cron: $PIPELINE_SCHEDULE)"; setup_pipeline

step "Backups (cron: $BACKUP_SCHEDULE)"; install_backup_cron

step "gunicorn service"
install_service
systemctl enable --now $SERVICE
systemctl restart $SERVICE
check_service

step "Admin account for $URL/admin/"
manage_as "$APP_USER" createsuperuser

step "Done: $URL"
[[ -z $TEST_MODE ]] || test_mode_warning
