install_packages() {
  apt-get update
  apt-get install -y git sudo curl openssl cron acl postgresql
}

install_uv() {
  command -v uv >/dev/null \
    || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
}

create_system_user() {
  id "$1" &>/dev/null \
    || useradd --system --create-home --home-dir "/var/lib/$1" --shell /usr/sbin/nologin "$1"
}

# The default ACL gives files created later, by anyone, the same group rights.
share_checkout() {
  if ! getent group "$DEV_GROUP" >/dev/null; then
    # The real server gets the group from DTU's directory.
    [[ -n ${TEST_MODE:-} ]] || { echo "The group '$DEV_GROUP' doesn't exist on this server." >&2; exit 1; }
    groupadd "$DEV_GROUP"
  fi
  chown -R root:"$DEV_GROUP" "$APP_DIR"
  setfacl -R -m g::rwX -m d:g::rwX -m o::rX -m d:o::rX "$APP_DIR"
  find "$APP_DIR" -type d -exec chmod g+s {} +
  git config core.sharedRepository group
  # git refuses a repository owned by someone else unless it is marked safe.
  git config --system --get-all safe.directory | grep -qxF "$APP_DIR" \
    || git config --system --add safe.directory "$APP_DIR"
}
