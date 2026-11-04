# Architecture

[Docs home](README.md) · [Architecture](structure.md) · [Development](development.md) · [Deployment](deployment.md) · [nginx](nginx.md) · [Operations](operations.md) · [Data analysis](data-analysis.md) · [Project README](../README.md)

How the frontend and backend work together.

- [Request flow](#request-flow)
- [Supporters](#supporters)
- [Students](#students)
- [Endpoints](#endpoints)

## Request flow

| Part | Folder | What it is |
| --- | --- | --- |
| Frontend | [`frontend/`](../frontend/) | Static HTML, CSS and JavaScript modules. No build step. |
| Backend | [`backend/`](../backend/) | Django app with a PostgreSQL database (SQLite in local development). Stores responses and problem logs, checks the supporter password, issues links and QR codes, and hosts the admin site. |
| Deployment | [`deploy/`](../deploy/) | Scripts and config for setting up and updating the server. |

```
browser ──▶ nginx (DTU, HTTPS) ──▶ gunicorn on 127.0.0.1:2810 ──▶ Django ──┬─ /api/, /admin/ ──▶ PostgreSQL (pis_survey)
                                                                        ├─ /static/        ──▶ backend/staticfiles/ (admin CSS/JS)
                                                                        └─ everything else ──▶ frontend/
```

DTU runs nginx on the server, with the certificate for `https://psqdb.compute.dtu.dk`. It
forwards every request to `http://127.0.0.1:2810`, where Django answers all of them,
including the frontend files (see `backend/pythonsupport/pythonsupport/urls.py`). The
nginx side is described in [nginx](nginx.md).

The frontend and the API are served from the same address, so the frontend calls the
API with relative URLs (see `frontend/js/config.js`). No cross-origin
requests are needed.

## Supporters

1. The supporter opens the site and enters the daily code. The frontend sends it to
   `POST /api/csrf/`. If it matches `SURVEY_PASSWORD`, the backend marks the session as
   authorized and returns a CSRF token. The session cookie lasts 24 hours.
2. The frontend keeps the token in `localStorage` and sends it as the `X-CSRFToken`
   header on every later request.
3. The supporter chooses a form:
   - **Customer Satisfaction**: pick a building, then the student fills in the survey.
     It is sent to `POST /api/responses/`.
   - **Internal Logging**: tick common problems or describe another one. It is sent to
     `POST /api/problem-logs/`.
4. If the backend is unreachable, the supporter can continue without a code: survey
   responses are queued on the device and uploaded once the backend answers and the code
   has been entered. They keep the time they were taken. Problem logs are not queued.

## Students

Students never log in. A supporter creates a link for them:

| Supporter action | Endpoint | Link | Valid |
| --- | --- | --- | --- |
| "Discord link" button | `POST /api/links/` | `?token=…` | 24 hours, one use, building recorded as `Online` |
| "QR" button | `POST /api/qr-codes/` | `?t=…` | 1–365 days, reusable, fixed building |

The student's survey posts to `POST /api/responses/` with the link's token in the body
instead of a session. The backend decides the building from the token. Student devices
have no offline queue: if the backend can't be reached, the form keeps its answers and the
student submits again.

## Endpoints

| Endpoint | Who | Purpose |
| --- | --- | --- |
| `POST /api/csrf/` | anyone with the password | Log in; returns the CSRF token |
| `POST /api/responses/` | logged-in supporter, or a student with a link token | Save a survey response |
| `POST /api/problem-logs/` | logged-in supporter | Save a problem log |
| `POST /api/links/` | logged-in supporter | Create a one-time link |
| `POST /api/qr-codes/` | logged-in supporter | Create a reusable QR link and its QR image |
| `/admin/` | Django staff accounts | Browse and export the data |
| `/admin/dashboard/` | Django staff accounts that may view survey responses | The dashboard the [notebook pipeline](operations.md#dashboard-pipeline) builds |
