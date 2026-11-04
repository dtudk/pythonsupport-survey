# Data analysis

[Docs home](README.md) · [Architecture](structure.md) · [Development](development.md) · [Deployment](deployment.md) · [nginx](nginx.md) · [Operations](operations.md) · [Data analysis](data-analysis.md) · [Project README](../README.md)

Jupyter notebooks run on your own machine and connect to the live database at
`psqdb.compute.dtu.dk:5432` over TLS, logging in with your DTU account and password.
Notebooks running on the server itself, such as the [pipeline](#pipeline), use PostgreSQL's
local socket.

- [Database logins](#database-logins)
- [Connecting from a notebook](#connecting-from-a-notebook)
- [Pipeline](#pipeline)
- [Old data](#old-data)

## Database logins

Rights in the database are defined in [`deploy/db-permissions.sql`](../deploy/db-permissions.sql).
To change them, edit that file, commit, and deploy with `manage.sh update`, which applies it.

| Schema | What goes there | `pis_analyst` | `pis_viewer` |
| --- | --- | --- | --- |
| `public` | Django's tables | read the `survey_*` tables only, except `survey_surveylink` (live link tokens) | nothing |
| `processed_data` | Results of the processing notebooks | read and write | nothing |
| `static_data` | Data from outside Django, such as the old survey | read and write | nothing |
| `published_data` | What viewers may see | read and write | read |

Every member of the `pythonsupport` group gets a database login named like their account, with
the `pis_analyst` role. PostgreSQL can't check Linux groups itself, so `deploy/manage.sh users`
creates the logins from the group's member list, and removes the logins of people who are no
longer in it (their tables stay, owned by `pis_analyst`). `setup.sh` runs it; run it again
whenever someone joins or leaves the group:

```sh
sudo /srv/pythonsupport-survey/deploy/manage.sh users
```

It only sees members listed in the group itself (`getent group pythonsupport`); someone
whose primary group is `pythonsupport` isn't listed there.

Every analyst session switches to `pis_analyst`, so tables the notebooks create belong to
`pis_analyst`, every analyst can change them, and they are covered by
[backups and restores](operations.md#backups-and-restore). Its `search_path` is
`processed_data, public`: tables created without a schema go to `processed_data`.

Viewers are added by hand, and `manage.sh users` leaves them alone:

```sh
sudo -u postgres psql -d pis_survey -c 'CREATE ROLE "<account>" LOGIN IN ROLE pis_viewer'
sudo -u postgres psql -d pis_survey -c 'DROP ROLE "<account>"'   # to remove them again
```


## Connecting from a notebook

The notebooks have their own [uv](https://docs.astral.sh/uv/) project in `notebooks/`, separate
from the backend's. Set it up from there:

```sh
cd notebooks
uv sync
```

Then open a notebook in VS Code and pick `notebooks/.venv` as its kernel.

`uv sync` installs what every notebook needs to query the database. Packages only some tasks
need are in groups in `notebooks/pyproject.toml`; add the ones you need:

| Group | For |
| --- | --- |
| `visualization` | `visualization/dashboard.ipynb` and other Altair charts |
| `pipeline` | `pipeline.py`; includes `visualization` |
| `student-data` | `fetching_data/get_student_data.ipynb` and `update_static_data.ipynb` |

```sh
uv sync --group visualization --group student-data
```

`uv sync` removes the groups you don't name, so name them every time, or use `--all-groups`.

Once per clone, also run `uv run nbstripout --install --attributes ../.gitattributes` in
`notebooks/`. Git then strips outputs from notebooks as you stage them, so student data shown
in a cell never gets committed; your own copy keeps its outputs. `uv sync` installs `nbstripout`
as a dev dependency. Without that command, git commits outputs as they are.

To add a package, run `uv add <package>` in `notebooks/`, or `uv add --group <group> <package>`
when only that group's task needs it, and commit `pyproject.toml` and `uv.lock` with it. `uv sync` also installs `notebooks/src/pis_lib/`, code shared by the notebooks,
so any notebook can import it as `pis_lib`; changes to it show up after restarting the kernel.

Then, in a notebook:

```python
import pandas as pd
from pis_lib.connect import get_pg_engine

db = get_pg_engine()  # or get_pg_engine("<your account>") if your local account is named differently

# Processing: raw data in, a redacted table out, in processed_data.
raw = pd.read_sql("SELECT * FROM survey_satisfactionsurveyresponse", db)
processed = raw.drop(columns=["student_number", "username"])
processed.to_sql("processed_responses", db, schema="processed_data", if_exists="replace", index=False)

# Visualization: only the processed table.
df = pd.read_sql('SELECT * FROM processed_data.processed_responses', db)
```

On your machine, `get_pg_engine()` ([`notebooks/src/pis_lib/connect.py`](../notebooks/src/pis_lib/connect.py)) takes
the password from `PGPASSWORD`, or asks for it. On the server, such as in the pipeline, it uses
PostgreSQL's local socket instead and needs no password; it logs in as the account running the
notebook.

Django keeps its tables in `public`, the default schema, and its migrations may change
anything there; analysts can only read its `survey_*` tables, except `survey_surveylink`.

Never put credentials (a `.env` with `AIT_PASSWORD`) or student data (such as
`old_data_sources/`) in the server's checkout, `/srv/pythonsupport-survey`. Every account on the
server can read files there, including `pis`, which runs Django. Keep them on your own machine,
or in your home directory on the server with mode `600`.

## Pipeline

[`notebooks/pipeline.py`](../notebooks/pipeline.py) runs the notebooks in `NOTEBOOKS` in order:
the two processing notebooks, then `visualization/dashboard.ipynb`. It stops at the first error
and saves no outputs into the notebooks. To run it on your machine:

```sh
cd notebooks
uv run --group pipeline python pipeline.py
```

The server runs it on a schedule as `pis-pipeline` and shows the dashboard at
`/admin/dashboard/` (see [Dashboard pipeline](operations.md#dashboard-pipeline)). A notebook in
`NOTEBOOKS` must run unattended, so it can't ask for input. On the server it can't write to the
checkout: save results to the database, and the dashboard to `DASHBOARD_HTML`. The server installs
only the dependencies and the `pipeline` group, so a package these notebooks import goes in one
of those.

## Old data

Responses from the old SharePoint survey are not in Django. Load the aggregated CSV into
its own table in `static_data` once, from a notebook connected as above:

```python
old = pd.read_csv("Aggregated_CustomerData.csv", na_values="N/A", parse_dates=["created_at"])
old["created_at"] = old["created_at"].dt.tz_localize("Europe/Copenhagen")  # CSV times are local
old.to_sql("old_responses", db, schema="static_data", if_exists="fail", index=False)
```

`if_exists="fail"` stops a second load from replacing or duplicating the table. Merge it
with Django's table in your processing step. The CSV contains student numbers; never commit
it, and delete your copy once it is loaded.
