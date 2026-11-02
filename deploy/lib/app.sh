# Needs DOMAIN and TEST_MODE from setup.sh.
write_env_file() {
  local env_file=backend/.env
  if [[ -f $env_file ]]; then
    echo "Keeping the existing $env_file."
  else
    local password
    # systemd's EnvironmentFile and uv's dotenv parser read other characters differently, and an
    # empty password locks every supporter out.
    until read -rsp "Supporter password (the daily code): " password || exit 1; echo
          [[ $password =~ ^[A-Za-z0-9_-]{12,}$ ]]; do
      echo "Use at least 12 letters, digits, '-' or '_'." >&2
    done
    install -m 640 -o root -g "$APP_USER" /dev/null "$env_file"
    cat > "$env_file" <<EOF
SECRET_KEY=$(openssl rand -hex 32)
ALLOWED_HOSTS=$DOMAIN
SURVEY_PASSWORD=$password
EOF
    [[ -z $TEST_MODE ]] || printf 'DEBUG=1\nPIS_BIND=0.0.0.0:%s\n' "$PORT" >> "$env_file"
  fi
  # Secrets: pis may only read them, and the developers' group gets no access (drop the ACL).
  setfacl -b "$env_file"
  chown root:"$APP_USER" "$env_file"
  chmod 640 "$env_file"
}

# As root, so pis and pis-pipeline can run the dependencies but not change them.
sync_deps() {
  uv sync --directory backend --locked --no-dev --compile-bytecode
  uv sync --directory notebooks --locked --no-dev --compile-bytecode
  # pis can't write __pycache__ into the root-owned checkout.
  backend/.venv/bin/python -m compileall -q backend/pythonsupport
}

# Reads the same env files as the service, in the same order.
manage_as() {
  local user=$1; shift
  sudo -u "$user" -H --preserve-env=PGOPTIONS uv run --no-sync --directory "$APP_DIR/backend/pythonsupport" \
    --env-file "$APP_DIR/backend/.env" --env-file "$APP_DIR/deploy/settings.env" python manage.py "$@"
}

install_service() {
  sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@APP_USER@|$APP_USER|g" -e "s|@PORT@|$PORT|g" deploy/$SERVICE.service \
    | install -m 644 /dev/stdin /etc/systemd/system/$SERVICE.service
  systemctl daemon-reload
}

# Asks gunicorn as nginx would: the Host header must be in ALLOWED_HOSTS.
check_service() {
  local host
  host=$(sed -n 's/^ALLOWED_HOSTS=\([^ ]*\).*/\1/p' backend/.env)
  for _ in {1..15}; do
    sleep 1
    curl -fsS -o /dev/null --max-time 5 -H "Host: $host" http://127.0.0.1:$PORT/admin/login/ 2>/dev/null && return 0
  done
  echo "Django did not answer on http://127.0.0.1:$PORT/admin/login/ within 15 seconds." >&2
  journalctl -u $SERVICE -n 30 --no-pager
  return 1
}
