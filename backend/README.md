# PIS Backend

A small Django backend for the PIS satisfaction survey. It receives survey
responses from the frontend, stores them in a database we own, and gives staff
an admin site to browse them.

## Where student data is stored

Student numbers are stored in these places, all on the server unless noted:

| Where | What | How long |
| --- | --- | --- |
| `public.survey_satisfactionsurveyresponse` | Every survey response | Until deleted |
| `processed_data.aggregated_responses` | The pipeline's copy of the old and new responses | Rebuilt by every pipeline run |
| `static_data.old_responses` | The old SharePoint survey | Until deleted |
| `static_data.students` | Student data from the snapshot (`update_static_data.ipynb`) | Replaced on every run of that notebook |
| `/var/backups/pis-survey/` | Nightly `pg_dump` files of the whole database | 30 days (`KEEP_DAYS`) |
| Supporter devices | The offline queue, and backup files supporters download | Queue: until sent; files: wherever saved |

`processed_data.processed_responses` and the dashboard have no student numbers; they use a
pseudonymous `visitor_id` (see [Data analysis](../docs/data-analysis.md)).

To delete one student's data:

```sh
sudo -u postgres psql -d pis_survey <<'SQL'
DELETE FROM public.survey_satisfactionsurveyresponse WHERE student_number = 's123456';
DELETE FROM static_data.old_responses WHERE student_number = 's123456';
DELETE FROM static_data.students WHERE student_number = 's123456';
SQL
sudo /srv/pythonsupport-survey/deploy/manage.sh pipeline   # rebuilds aggregated_responses
```

Also remove the student from the snapshot CSV, or `static_data.students` gets them back on the
next run of `update_static_data.ipynb`. The dumps keep the data until they are 30 days old.

## How it works

- `POST /api/csrf/` with `{"password": "..."}`: checks the shared survey
  password (`SURVEY_PASSWORD`), marks the session as authorized, and returns a
  CSRF token. The session lasts 24 hours from login (`SESSION_COOKIE_AGE`), and the
  frontend also asks for the password again on each new day.
- `POST /api/responses/`: saves a response. The caller needs either an
  authorized session plus the `X-CSRFToken` header, or a link `token` in the
  body. A response a supporter's device queued offline also sends `saved_at`,
  the time it was queued; it becomes `created_at` if it is no more than 7 days
  old and not in the future. Link submissions come from students' phones, which
  never queue, so their `saved_at` is ignored. Deleting a link in the admin
  revokes it.
- `POST /api/problem-logs/`: saves the internal supporter problem log. It uses
  the same authorized session and CSRF token as the survey. The JSON body is
  `{"problems": ["Files and Folders", "Antivirus"], "other": "Optional note"}`.
- `POST /api/links/`: an authorized supporter creates a one-time link for a
  student (for example on Discord). It is valid for 24 hours and is deleted on
  use. Link submissions are recorded with the building `Online`.
- `POST /api/qr-codes/`: an authorized supporter creates a reusable link for a
  QR code. The body is `{"building_number": 302, "valid_days": 7}`; the link
  records that building and stays valid for 1-365 days.
- `/admin/`: the Django admin, for staff accounts.
- `/admin/dashboard/`: the dashboard the notebook pipeline builds, for staff
  accounts that may view survey responses.

The code lives in `pythonsupport/survey/`; the project settings are in
`pythonsupport/pythonsupport/settings.py`.

## Development and deployment

Local development, how the backend works with the frontend, and the server deployment
(`deploy/`) are described in the [documentation](../docs/README.md).

Run the tests (from `pythonsupport/`):

```sh
uv run --env-file ../.env python manage.py test
```

After changing `models.py`:

```sh
uv run --env-file ../.env python manage.py makemigrations
uv run --env-file ../.env python manage.py migrate
```

Commit the generated migration together with the model change.

