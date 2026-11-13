# If a step after pulling fails, rollback restores the previous code and, once migrations have
# started, the database.

# For a session that reconnects after end_other_sessions: migrate fails instead of hanging.
LOCK_TIMEOUT='-c lock_timeout=60s'

public_tables() { pg_admin -d "$DATABASE_NAME" -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"; }

# An open transaction, e.g. in an analyst's notebook, would block migrate and the restore. The
# analysts are the team, and their notebooks reconnect on the next query.
end_other_sessions() {
  pg_admin -d "$DATABASE_NAME" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()" >/dev/null
}

update_app() {
  local branch=$1
  if [[ -z ${PIS_UPDATE_FROM:-} ]]; then
    step "Code ($branch)"
    local from prev
    from=$(git rev-parse HEAD)
    prev=$(git symbolic-ref -q --short HEAD || echo "$from")
    git fetch origin
    git checkout "$branch"
    # The frontend is served from these files: a failed pull or a deploy/-less branch must not stay.
    { git pull --ff-only origin "$branch" && [[ -x deploy/manage.sh ]]; } \
      || { echo "Can't deploy $branch: the pull failed or it has no deploy/manage.sh." >&2; git checkout -q "$prev"; exit 1; }
    # Re-exec, so changes to the deploy scripts apply to this run.
    PIS_UPDATE_FROM=$from exec "$APP_DIR/deploy/manage.sh" update "$branch"
  fi

  BACKUP= TABLES_BEFORE=
  trap '[[ $? -eq 0 ]] || rollback' EXIT

  step "Python dependencies"
  sync_deps
  manage_as root collectstatic --no-input

  # Stopped, so a restore can't lose responses. Supporters' devices queue them meanwhile.
  step "Backup and migrations"
  systemctl stop $SERVICE
  # Before the backup, so a backup to restore always comes with this list.
  TABLES_BEFORE=$(public_tables)
  BACKUP=$(backup_db)
  end_other_sessions
  PGOPTIONS=$LOCK_TIMEOUT manage_as "$APP_USER" migrate
  apply_db_permissions

  step "Start"
  install_service
  # The cron jobs may point at scripts that have moved.
  install_backup_cron
  setup_pipeline
  systemctl start $SERVICE
  check_service

  step "Done. Frontend files are served straight from the checkout, so they are live already."
}

rollback() {
  set +e
  trap - EXIT
  step "FAILED. Rolling back to $PIS_UPDATE_FROM"
  systemctl stop $SERVICE
  local restore_failed=
  if [[ -n $BACKUP ]]; then
    echo "Restoring the database from $BACKUP"
    # Again: sessions may have reconnected since migrate, and the dump sets lock_timeout = 0.
    end_other_sessions
    # postgres can't open the root-only backup directory, so pass the dump on stdin.
    if runuser -u postgres -- \
         pg_restore --clean --if-exists --single-transaction --dbname="$DATABASE_NAME" < "$BACKUP"; then
      # --clean drops only what the dump holds, so tables the new migrations added are still there.
      PGOPTIONS=$LOCK_TIMEOUT pg_admin -d "$DATABASE_NAME" -v before="$TABLES_BEFORE" <<'SQL' || restore_failed=1
SELECT format('DROP TABLE public.%I CASCADE', tablename) FROM pg_tables
 WHERE schemaname = 'public' AND tablename <> ALL (string_to_array(:'before', E'\n'))
\gexec
SQL
    else
      restore_failed=1
    fi
  fi
  git checkout --detach "$PIS_UPDATE_FROM"
  sync_deps
  manage_as root collectstatic --no-input
  install_service
  systemctl start $SERVICE
  if ! check_service; then
    echo "The previous version did not come back up either. The site is down." >&2
  elif [[ -n $restore_failed ]]; then
    echo "The previous version is running, but restoring the database failed, so it may still be on" \
         "the new version's schema. Restore $BACKUP by hand (docs/operations.md, \"Backups and" \
         "restore\"), then run 'manage.sh update' again." >&2
  else
    echo "The previous version is running again. Fix the problem, then run 'manage.sh update' again."
  fi
  exit 1
}
