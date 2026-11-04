pg_admin() { runuser -u postgres -- psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }

setup_database() {
  # apt doesn't start services in Docker images.
  systemctl enable --now postgresql
  [[ $(pg_admin -c "SELECT 1 FROM pg_roles WHERE rolname = '$APP_USER'") == 1 ]] \
    || runuser -u postgres -- createuser "$APP_USER"
  [[ $(pg_admin -c "SELECT 1 FROM pg_database WHERE datname = '$DATABASE_NAME'") == 1 ]] \
    || runuser -u postgres -- createdb --owner="$APP_USER" "$DATABASE_NAME"
}

apply_db_permissions() {
  pg_admin -1 -d "$DATABASE_NAME" -v analyst="$ANALYST_ROLE" -v viewer="$VIEWER_ROLE" \
    < deploy/db-permissions.sql
}

# nginx terminates TLS, so logins arrive as plain "host" connections from its address ("hostssl"
# never matches). Allowing only that address stops anyone skipping TLS. Check it remotely with
# SELECT inet_client_addr();
# PAM would let a DTU account named like a service role in as that role, so those are refused
# first. Django and the pipeline use the local socket, which "host" lines don't cover.
HBA_LINES="host all $APP_USER,$PIPELINE_USER,postgres 127.0.0.1/32 reject
host $DATABASE_NAME all 127.0.0.1/32 pam pamservice=postgresql"

setup_pam_auth() {
  # root-owned: whoever can edit it can make every password succeed.
  install -o root -g root -m 644 /dev/stdin /etc/pam.d/postgresql <<'EOF'
auth     required  pam_sss.so
account  required  pam_sss.so
EOF

  # Before the first host* line: the first match wins.
  local hba
  hba=$(pg_admin -c 'SHOW hba_file')
  cp -p "$hba" "$hba.bak"
  if ! grep -qxF "${HBA_LINES%%$'\n'*}" "$hba"; then
    HBA_LINES=$HBA_LINES awk '!done && /^host/ {print ENVIRON["HBA_LINES"]; done=1} {print}
                              END {if (!done) print ENVIRON["HBA_LINES"]}' "$hba" > "$hba.new"
    cat "$hba.new" > "$hba" && rm "$hba.new"   # cat keeps the file's owner and mode
  fi

  # PostgreSQL won't start with an invalid pg_hba.conf.
  if pg_admin -c "SELECT 'pg_hba.conf line ' || line_number || ': ' || error
                  FROM pg_hba_file_rules WHERE error IS NOT NULL" | grep .; then
    cat "$hba.bak" > "$hba"
    echo "pg_hba.conf left unchanged." >&2
    return 1
  fi
  pg_admin -c 'SELECT pg_reload_conf()' >/dev/null
}

# Sessions switch to pis_analyst, so analysts share the tables they create.
# Needs apply_db_permissions to have run.
analyst_login() {
  local user=$1
  [[ $(pg_admin -d "$DATABASE_NAME" -c "SELECT 1 FROM pg_roles WHERE rolname = '$user'") == 1 ]] \
    || pg_admin -d "$DATABASE_NAME" -c "CREATE ROLE \"$user\" LOGIN"
  [[ $(pg_admin -d "$DATABASE_NAME" -c "SELECT pg_has_role('$user', '$ANALYST_ROLE', 'MEMBER')") == t ]] \
    || pg_admin -d "$DATABASE_NAME" -c "GRANT $ANALYST_ROLE TO \"$user\""
  pg_admin -d "$DATABASE_NAME" -c "ALTER ROLE \"$user\" SET role = $ANALYST_ROLE"
  pg_admin -d "$DATABASE_NAME" -c "ALTER ROLE \"$user\" SET search_path = processed_data, public"
}

# PostgreSQL can't check Linux groups, so each member gets a login named like their account.
sync_db_users() {
  local members user
  # Misses people whose primary group it is.
  members=" $(getent group "$DEV_GROUP" | cut -d: -f4 | tr , ' ') "

  for user in $members; do
    # Names come from the directory service and go into SQL: allow only plain account names.
    [[ $user =~ ^[a-z0-9_.-]+$ ]] || { echo "Skipping unusual account name: $user" >&2; continue; }
    analyst_login "$user"
    echo "Notebook access: $user"
  done

  # Any other member of pis_analyst has left the group.
  for user in $(pg_admin -d "$DATABASE_NAME" -c "SELECT r.rolname FROM pg_auth_members m
                                      JOIN pg_roles r ON r.oid = m.member
                                      JOIN pg_roles p ON p.oid = m.roleid
                                      WHERE p.rolname = '$ANALYST_ROLE'
                                        AND r.rolname NOT IN ('$APP_USER', '$PIPELINE_USER')"); do
    [[ $members == *" $user "* ]] && continue
    # Its tables go to pis_analyst, so no data is lost.
    pg_admin -d "$DATABASE_NAME" -c "REASSIGN OWNED BY \"$user\" TO $ANALYST_ROLE; DROP OWNED BY \"$user\"; DROP ROLE \"$user\""
    echo "Removed notebook access: $user"
  done
}
