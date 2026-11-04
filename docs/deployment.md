# Deployment

[Docs home](README.md) · [Architecture](structure.md) · [Development](development.md) · [Deployment](deployment.md) · [nginx](nginx.md) · [Operations](operations.md) · [Data analysis](data-analysis.md) · [Project README](../README.md)

- [What runs on the server](#what-runs-on-the-server)
- [Before you start](#before-you-start)
- [First-time setup](#first-time-setup)
- [Trying the setup locally (test mode)](#trying-the-setup-locally-test-mode)
- [Test server](#test-server)
- [Updating](#updating)

## What runs on the server

HTTPS is handled by DTU's nginx, which is already set up on the server
(`/etc/nginx/conf.d/psqdb.conf`, not part of this repository; see [nginx](nginx.md)). Our
part only has to answer on `127.0.0.1:2810`.

The server runs two processes and a scheduled job:

- **gunicorn**: runs Django as the systemd service `pis-survey`, as the system user
  `pis`, listening on `127.0.0.1:2810` only (for the forwarding details, see
  [Architecture](structure.md#request-flow)).
- **PostgreSQL**: the database `pis_survey`, owned by the database user `pis`, backed up
  daily. Django's tables are in the `public` schema; processed tables from the notebooks go
  in the `processed_data` schema (see [Data analysis](data-analysis.md)).
- **The notebook pipeline**: cron runs `notebooks/pipeline.py` as the system user
  `pis-pipeline`, every hour from 8:00 to 16:00 and at midnight. It rebuilds the processed
  tables and the dashboard that the admin shows at `/admin/dashboard/` (see
  [Dashboard pipeline](operations.md#dashboard-pipeline)).

The code lives in one checkout at `/srv/pythonsupport-survey`, and the scripts and config
files expect that path. The data lives in PostgreSQL, so re-cloning or cleaning the checkout
can never delete it.

Django, and notebooks running on the server, connect over PostgreSQL's local socket, as the
operating-system user they run as (peer authentication), so they need no database password.
Notebooks elsewhere connect through nginx over TLS and log in with their DTU password (PAM).

| File in `deploy/` | Purpose |
| --- | --- |
| `setup.sh` | First-time setup of a fresh server |
| `manage.sh update [branch]` | Deploy new code |
| `manage.sh backup` | Back up the database (daily from cron, and before every update) |
| `manage.sh users` | Database logins for the `pythonsupport` group (see [Data analysis](data-analysis.md#database-logins)) |
| `manage.sh pipeline` | Run the notebook pipeline now (it also runs from cron) |
| `settings.env` | All settings that are the same on every server (paths, users, database, port, schedules); see [Changing settings](operations.md#changing-settings) |
| `lib/common.sh` | Loads `settings.env` and the other files in `lib/`, and checks that the script runs as root from the checkout |
| `lib/system.sh` | Packages, uv, the system users and the shared checkout |
| `db-permissions.sql` | Schemas, roles and their rights in the database (see [Data analysis](data-analysis.md#database-logins)) |
| `lib/postgres.sh` | The database, PAM password logins and the group's logins |
| `lib/app.sh` | `backend/.env`, dependencies, `manage.py` and the gunicorn service |
| `lib/backup.sh` | Backups and their cron job |
| `lib/pipeline.sh` | The notebook pipeline: its user, database login, dashboard folder and cron job |
| `lib/update.sh` | Updating, with rollback |
| `pis-survey.service` | systemd unit for gunicorn; the scripts fill in its paths, user and port from `settings.env` |

## Before you start

- A Debian or Ubuntu server where you have `sudo`, with the `pythonsupport` group for the
  people working on the project (see [Permissions](operations.md#permissions)).
- nginx on that server forwarding `https://psqdb.compute.dtu.dk` to port 2810, configured
  as in [nginx](nginx.md).
- The supporter password you want to use: at least 12 letters, digits, `-` or `_`.
  `setup.sh` refuses anything else, because the password is stored in an environment file,
  where other characters get special meaning.

## First-time setup

1. Clone the repository to `/srv/pythonsupport-survey`:

   ```sh
   sudo git clone https://github.com/RNS-ago/pythonsupport-survey.git /srv/pythonsupport-survey
   ```

   If the repository is private, add a
   [deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
   for root (in `/root/.ssh/`) and clone with the `git@github.com:` URL instead.
   `manage.sh update` runs `git` as root.

2. Run the setup script with your domain:

   ```sh
   sudo /srv/pythonsupport-survey/deploy/setup.sh psqdb.compute.dtu.dk
   ```

   It will:

   1. Install git, PostgreSQL and uv.
   2. Create the `pis` system user, and make root and the `pythonsupport` group the owners
      of the checkout.
   3. Ask for the supporter password and write `backend/.env` with it, a random
      `SECRET_KEY` and `ALLOWED_HOSTS`. Root owns it; `pis` can only read it.
   4. Create the PostgreSQL user `pis` and the database `pis_survey`, and set up password
      logins through PAM (SSSD).
   5. Install the Python dependencies of the backend and the notebooks, create Django's
      tables, and collect the admin's static files.
   6. Apply `deploy/db-permissions.sql` (the `processed_data`, `static_data` and
      `published_data` schemas, and the `pis_analyst` and `pis_viewer` roles), and create a
      database login for every member of `pythonsupport` for the
      [notebooks](data-analysis.md).
   7. Create the `pis-pipeline` system user with its database login, the dashboard folder
      `/var/lib/pis-dashboard`, and the pipeline's cron job.
   8. Install the daily backup cron job.
   9. Start the `pis-survey` service on `127.0.0.1:2810`, and check that Django answers.
   10. Ask you to create the first admin account for `/admin/`.

   If a step fails, fix the cause and run the script again. It keeps the existing
   `.env`, so rerunning it is safe.

3. Open `https://psqdb.compute.dtu.dk`, log in with the supporter password, and submit a
   test response and a test problem log. Check that both appear under
   `https://psqdb.compute.dtu.dk/admin/`.

4. Load the old survey (`static_data.old_responses`, see [Old data](data-analysis.md#old-data))
   and the student data (`static_data.students`), which the pipeline reads. Then build the
   dashboard without waiting for cron, and check that it opens at
   `https://psqdb.compute.dtu.dk/admin/dashboard/`:

   ```sh
   sudo /srv/pythonsupport-survey/deploy/manage.sh pipeline
   ```

The site only works over HTTPS: in production the session cookie is HTTPS-only, so
logging in over plain HTTP fails. If the site answers `400 Bad Request` or `502 Bad
Gateway`, check [nginx](nginx.md) and `sudo systemctl status pis-survey`.

## Trying the setup locally (test mode)

To try `setup.sh` without a domain, for example on the [test server](#test-server) or in a
Debian or Ubuntu VM, clone the repository to `/srv/pythonsupport-survey` as above and run:

```sh
sudo /srv/pythonsupport-survey/deploy/setup.sh --test            # serves http://localhost:2810
sudo /srv/pythonsupport-survey/deploy/setup.sh --test my-vm.lan  # or another host name
```

Test mode differs from a real setup in two ways, both written to `backend/.env`:

- `PIS_BIND=0.0.0.0:2810`: there is no nginx in front, so gunicorn serves plain HTTP on
  port 2810 to other machines too, not only to localhost.
- `DEBUG=1`: without HTTPS, the production session cookie (HTTPS-only) would never be sent
  back, and logging in would fail.

The script prints a warning at the start and the end. **Never use test mode in
production**: debug mode shows detailed error pages, and without HTTPS the supporter
password travels unencrypted.

Test mode only writes these when it creates `backend/.env`. If a `.env` already exists
from an earlier run without `--test`, add them by hand, then run
`sudo systemctl restart pis-survey`.

## Test server

`deploy/test-server/` boots a fresh Debian 13 container, like psqdb, with systemd as the init
process, so `systemctl`, `journalctl` and cron behave as on the server. It needs
[Podman](https://podman.io) and `podman-compose` (`uv tool install podman-compose`), run as
your own user, not root. From `deploy/test-server/`:

```sh
podman-compose up -d --build      # boot a fresh server
podman-compose exec server bash   # log in as root
```

Inside, clone your checkout and run test mode. You are already root, and `setup.sh` installs
`sudo` itself:

```sh
git clone /mnt/repo /srv/pythonsupport-survey
/srv/pythonsupport-survey/deploy/setup.sh --test
```

The site is then at <http://localhost:8080>. `/mnt/repo` is your checkout, mounted read-only,
and becomes the clone's `origin`, so `manage.sh update` deploys what you have committed
locally, not what is on GitHub.

`podman-compose down` deletes the container; the next `up` starts a fresh server.

## Updating

Merge your changes to `main`, then on the server:

```sh
sudo /srv/pythonsupport-survey/deploy/manage.sh update
```

To deploy another branch, for example for testing: `sudo /srv/pythonsupport-survey/deploy/manage.sh update my-branch`.

The script pulls the code, installs the backend's and the notebooks' dependencies and
collects static files. It then stops gunicorn, backs up the database, ends every other database
session (an open transaction, such as in an analyst's notebook, would block the migrations), applies migrations,
updates the pipeline's setup and starts gunicorn again. The site is
down for the few seconds of the migrations; supporters' devices queue survey responses
meanwhile.

After starting gunicorn, the script checks that Django answers. If any step after the pull
fails, it rolls back: it restores the database from the backup it just made (if migrations
had started), checks out the previous commit and starts that version again. The checkout is
then on a detached commit; the next `manage.sh update` returns to the branch.

Frontend changes are live as soon as the code is pulled. The frontend is served with
`Cache-Control: no-cache`, so browsers check for a newer copy on every load; a page that is
already open keeps running the old files until it is reloaded.
