# Operations

[Docs home](README.md) · [Architecture](structure.md) · [Development](development.md) · [Deployment](deployment.md) · [nginx](nginx.md) · [Operations](operations.md) · [Data analysis](data-analysis.md) · [Project README](../README.md)

Running the server after [deployment](deployment.md).

- [Changing settings](#changing-settings)
- [Permissions](#permissions)
- [Dashboard pipeline](#dashboard-pipeline)
- [Backups and restore](#backups-and-restore)
- [Useful commands](#useful-commands)

## Changing settings

The settings live in two files. gunicorn and `manage.py` read both, `settings.env` last, so
its values win when both set the same name.

[`deploy/settings.env`](../deploy/settings.env) is committed and holds everything that is the
same on every server: paths, users, the database name (`DATABASE_NAME`), the port, the backup
and pipeline schedules, and where the dashboard is written (`DASHBOARD_HTML`). The deploy scripts
and the systemd unit read it too. To change one, edit it, commit, and deploy with
`manage.sh update`. Most of them describe the setup itself, so changing
one on a running server also means moving what it names, for example the database or the
checkout.

`/srv/pythonsupport-survey/backend/.env` is written by `setup.sh` and holds the secrets and
what differs per server:

| Variable | Meaning |
| --- | --- |
| `SECRET_KEY` | Django's signing key. Changing it logs everyone out. |
| `ALLOWED_HOSTS` | Space-separated host names the site answers to |
| `SURVEY_PASSWORD` | The supporter password (daily code) |
| `DEBUG` | Leave unset in production. `1` turns on debug mode. |
| `PIS_BIND` | Only in test mode: `0.0.0.0:2810`, so gunicorn answers other machines too |

Edit it with `sudo`, then run `sudo systemctl restart pis-survey`.

## Permissions

Django runs as the `pis` user, and `pis` can change only the data, never the program. The
people working on the project, the server's `pythonsupport` group, can change the program:

| Path | Owner | `pythonsupport` can | `pis` can | `pis-pipeline` can |
| --- | --- | --- | --- | --- |
| `/srv/pythonsupport-survey/` (code, `backend/.venv`, `notebooks/.venv`, `backend/staticfiles`), except `backend/.env` | root, group `pythonsupport` | read and write | read | read |
| `/srv/pythonsupport-survey/backend/.env` | root, group `pis` | nothing | read | nothing |
| `/opt/uv-python/` (the Python that uv installs) | root | read | read | read |
| The `pis_survey` database | PostgreSQL user `pis` | through a [notebook login](data-analysis.md#database-logins), as in `deploy/db-permissions.sql` | read and write | the same as `pythonsupport` |
| `/var/lib/pis-dashboard/` (the dashboard) | `pis-pipeline`, group `pis` | nothing | read | read and write |
| `/var/backups/pis-survey/` | root | nothing | nothing | nothing |

Root runs code from the checkout (the nightly backup cron, `manage.sh update`), so membership
in `pythonsupport` is equivalent to root. The "nothing" entries above are file permissions,
not a security boundary. Add only people who also have full `sudo`.

`backend/.env` holds the secrets (`SECRET_KEY` and the supporter password), so `setup.sh`
takes it out of the group's access: it removes the ACL the rest of the checkout gets, and
sets the owner to root, group `pis`, mode `640`.

If an attacker ever finds a bug that lets them run code inside Django, that code runs as
`pis`. It can reach the data, since the app needs that to work, but it cannot plant a
backdoor in the backend or change the JavaScript that supporters' browsers load. Fixing the
bug and restarting the service removes them.

This is why the scripts run `git`, `uv sync` and `collectstatic` as root, and only the
commands that touch Django's tables (`migrate`, `createsuperuser`) as `pis`. Run
manual commands the same way: `sudo` (or your own account, if you're in `pythonsupport`)
for anything in the checkout, `sudo -u pis` for anything that touches the database. Never
add `pis` or `pis-pipeline` to the `pythonsupport` group.

`setup.sh` sets up the checkout for the group:

- The group owns every file, and new directories inherit it (setgid).
- A default ACL gives every file created later, by anyone or by `git pull`, read and write
  for the group, whatever the creator's umask. `core.sharedRepository=group` does the same
  for git's own files.
- The checkout is marked as a git `safe.directory` for everyone, because git otherwise
  refuses to work in a repository owned by another user (root).

Members can run `git` in the checkout and edit files there, but deploying with
`manage.sh update` still needs `sudo`. Edits in the checkout are live: frontend files at once,
backend code after `sudo systemctl restart pis-survey`. Prefer committing and deploying
with `manage.sh update`; its `git pull --ff-only` stops if the checkout has local commits or
conflicting edits.

## Dashboard pipeline

Cron runs `notebooks/pipeline.py` every hour from 8:00 to 16:00 and at midnight
(`PIPELINE_SCHEDULE` in `deploy/settings.env`). It runs the processing notebooks, which
replace the tables in `processed_data`, and then `dashboard.ipynb`, which writes
`/var/lib/pis-dashboard/dashboard.html`. Staff accounts that may view survey responses open
it at `/admin/dashboard/`, or from the link on the admin start page.

The pipeline runs as its own system user, `pis-pipeline`, with a database login in
`pis_analyst`, like an analyst's. It can read the checkout but not change it. Besides the
database, it writes to its home folder (`/var/lib/pis-pipeline`, for Jupyter's files and the
run lock), the dashboard folder and `/tmp`. It doesn't run as `pis`, for two reasons:

- Jupyter runs startup files from the running account's home folder. Code running as `pis`
  after a bug in Django is exploited could plant some there, and restarting the service
  wouldn't remove it.
- Django shows the page to admins. If `pis` could change it, such code could add scripts to
  it.

The page itself is built to be safe next to the admin:

- Django sends it with a `Content-Security-Policy` (in `survey/views.py`). Its `sandbox` makes
  the browser treat the page as a separate site, so its scripts can't use the admin's session.
  The rest stops the page from sending its rows anywhere: no requests, form posts or images
  from other sites.
- It includes its own copy of Vega instead of loading it from a CDN. Vega runs the charts'
  expressions with its interpreter, because the policy blocks `eval`.
- Text in the data, such as `</script>`, can't break out of the page's scripts: the notebook
  writes every `<` in the data as `\u003c`.
- Its ⋯ menu only offers image downloads.
- The notebook writes it to a temporary file and then renames it, so nobody opens a
  half-written page.

To run the pipeline now, for example after loading new data:

```sh
sudo /srv/pythonsupport-survey/deploy/manage.sh pipeline
```

The cron runs write to the journal: `sudo journalctl -t pis-pipeline`. A run stops at the
first notebook that fails, and the admin keeps showing the last dashboard that was built.
Only one run goes at a time: a run that would overlap the previous one is skipped, and a run
still going after 10 minutes is stopped, for example one waiting for a table an analyst has
open. `manage.sh` jobs other than `pipeline` share the same lock: runs due during an `update` or
backup are skipped, and `manage.sh` waits up to 30 minutes for a run, or another job, to finish.

## Backups and restore

`deploy/manage.sh backup` runs daily at 03:00 and before every update. It writes
`/var/backups/pis-survey/db-<date>.dump` (a `pg_dump` of the whole database, including the
analysts' schemas) and deletes dumps older than 30 days (`KEEP_DAYS` in `deploy/settings.env`). The
backups contain student numbers: keep them only on storage the team controls, and only as
long as the retention policy allows. The nightly run logs to the journal
(`sudo journalctl -t pis-survey-backup`); a night with no `db-<date>-0300xx.dump` means it failed.

The script runs as root: `pg_dump` runs as `postgres`, so it covers every schema without `pis`
needing access to the analysts' data, and root writes the dump to a directory only root can open. Code running as `pis` (for example after a bug
in Django is exploited) can corrupt the database, but not the existing backups. Dumps made
after such corruption contain it too, so the older dumps are the ones to restore. The
backups do not survive a compromise of root; for that, copy them off the server.

To restore a backup:

```sh
sudo systemctl stop pis-survey
sudo cat /var/backups/pis-survey/db-<date>.dump \
  | sudo -u postgres pg_restore --clean --if-exists --single-transaction --dbname=pis_survey
sudo systemctl start pis-survey
```

`postgres` can't open the backup directory, so root reads the dump and passes it on stdin.
`--single-transaction` means a failed restore changes nothing. The restore waits, without a time
limit, for any open transaction on the tables it replaces, for example an analyst's notebook. If it
hangs, end the other sessions from a second terminal:

```sh
sudo -u postgres psql -d pis_survey -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"
```

## Useful commands

```sh
sudo systemctl status pis-survey         # is gunicorn running?
sudo journalctl -u pis-survey -f         # backend log
sudo journalctl -t pis-pipeline          # notebook pipeline log
sudo journalctl -t pis-survey-backup     # nightly backup log
sudo -u pis psql pis_survey              # SQL shell on the database
```
