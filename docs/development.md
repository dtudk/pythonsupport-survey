# Development

[Docs home](README.md) · [Architecture](structure.md) · [Development](development.md) · [Deployment](deployment.md) · [nginx](nginx.md) · [Operations](operations.md) · [Data analysis](data-analysis.md) · [Project README](../README.md)

- [Local setup](#local-setup)
- [Database](#database)
- [Tests](#tests)

## Local setup

Requirements: [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 itself).

```sh
cd backend
uv sync

# Local settings. .env is git-ignored.
cat > .env <<'EOF'
DEBUG=1
SECRET_KEY=dev
ALLOWED_HOSTS=localhost 127.0.0.1
SURVEY_PASSWORD=devpassword
EOF

cd pythonsupport
uv run --env-file ../.env python manage.py migrate
uv run --env-file ../.env python manage.py createsuperuser   # for /admin/
uv run --env-file ../.env python manage.py runserver
```

Open <http://localhost:8000/>. In development Django serves the frontend itself (see
`backend/pythonsupport/pythonsupport/urls.py`), so changes to `frontend/` show up on
reload.

`DEBUG=1` matters locally: without it the session cookie is HTTPS-only, and logging in
over `http://localhost` fails.

## Database

Locally, the database is the SQLite file `backend/pythonsupport/db.sqlite3` (git-ignored),
so you don't need to install PostgreSQL. The server uses PostgreSQL, which Django switches
to when `DATABASE_NAME` is set (see [Changing settings](operations.md#changing-settings)).
The code only uses Django's ORM, so both behave the same.

## Tests

Run the backend tests from `backend/pythonsupport/`:

```sh
uv run --env-file ../.env python manage.py test
```
