# postgres reads the database, so the dump covers every schema without pis needing access to
# them; root writes the dumps, so a compromised app can't touch them.

# Prints only the dump's path on stdout: update_app restores from it on failure.
backup_db() {
  local file
  file=$BACKUP_DIR/db-$(date +%F-%H%M%S).dump
  # The shell creates the file before pg_dump runs, so remove it if the dump fails.
  runuser -u postgres -- pg_dump --format=custom "$DATABASE_NAME" > "$file" || { rm -f "$file"; return 1; }
  echo "$file"
  find "$BACKUP_DIR" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
}

install_backup_cron() {
  install -d -m 700 -o root -g root "$BACKUP_DIR"
  # Debian's cron PATH lacks /usr/sbin, where runuser is.
  cat > /etc/cron.d/$SERVICE <<EOF
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
$BACKUP_SCHEDULE root $APP_DIR/deploy/manage.sh backup 2>&1 | systemd-cat -t $SERVICE-backup
EOF
  # apt doesn't start services in Docker images.
  systemctl enable --now cron
}
