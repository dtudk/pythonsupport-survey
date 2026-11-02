# DTU Python Support Survey

Tools for DTU Python Support (PIS) supporters:

- **Customer satisfaction survey**: students rate the help they got, on a supporter's
  screen, on a tablet in kiosk mode, or through a one-time link or QR code.
- **Internal problem log**: supporters record which common problems they helped with.

A static frontend and a Django backend, deployed together at
<https://psqdb.compute.dtu.dk> behind DTU's nginx.

## Contents

- [Development](#development)
- [Documentation](#documentation)

## Development

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

Open <http://localhost:8000/> and log in with `devpassword`.

| Folder | What it is |
| --- | --- |
| [`frontend/`](frontend/) | Static HTML, CSS and JavaScript modules. No build step. |
| [`backend/`](backend/) | Django app with PostgreSQL on the server, SQLite locally. |
| [`deploy/`](deploy/) | Scripts and config for setting up and updating the server. |
| [`notebooks/`](notebooks/) | Jupyter notebooks for data analysis, with their own uv project. |
| [`docs/`](docs/) | Project documentation. |

- Django serves the frontend in development, so changes to `frontend/` show up on reload.
- Run the backend tests from `backend/pythonsupport/`:

  ```sh
  uv run --env-file ../.env python manage.py test
  ```

- To deploy, merge to `main`, then on the server run
  `sudo /srv/pythonsupport-survey/deploy/manage.sh update`
  (see [Updating](docs/deployment.md#updating)).

More detail in [Development](docs/development.md).

## Documentation

Start at the [documentation index](docs/README.md). The main pages:

- [Architecture](docs/structure.md): how the frontend and backend work together, and the API.
- [Development](docs/development.md): local setup and tests.
- [Deployment](docs/deployment.md): setting up and updating the server.
- [nginx](docs/nginx.md): the DTU nginx configuration in front of the app.
- [Operations](docs/operations.md): settings, permissions, backups and useful commands.
- [Data analysis](docs/data-analysis.md): reading the database from Jupyter notebooks.
