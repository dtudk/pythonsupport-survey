"""Connect a notebook to our databases. Both functions read a .env file first.

get_pg_engine(): pis_survey. On the server, over the local socket with no password. Elsewhere,
over TLS with your DTU login: PGUSER, else the local account name, or pass it
(get_pg_engine("s123456")). The password comes from PGPASSWORD, else you are asked for it.

get_ait_engine(): AIT's SQL Server with the student data. Needs AIT_USERNAME and AIT_PASSWORD
and never prompts, so it can run unattended.
"""
import os
import socket
from getpass import getpass
from pathlib import Path

import certifi
from dotenv import dotenv_values, load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL

import mssql_python

# Use only names that mean the same here as on the server: DASHBOARD_HTML is a server path.
SETTINGS = dotenv_values(Path(__file__).resolve().parents[3] / "deploy" / "settings.env")

PG_SERVER = "psqdb.compute.dtu.dk"
PG_DATABASE = SETTINGS["DATABASE_NAME"]
PG_SOCKET_DIR = "/var/run/postgresql"

AIT_SERVER = "AIT-PIMSQLAG1L.win.dtu.dk"
AIT_DATABASE = "DTU_Matrikel"


def get_pg_engine(user=None):
    load_dotenv()
    if socket.gethostname().split(".")[0] == PG_SERVER.split(".")[0]:
        url = URL.create("postgresql+psycopg", username=user, host=PG_SOCKET_DIR, database=PG_DATABASE)
    else:
        url = URL.create(
            "postgresql+psycopg",
            username=user,  # None: libpq uses PGUSER, else the local account name
            password=os.environ.get("PGPASSWORD") or getpass("DTU password: "),
            host=PG_SERVER,
            port=5432,
            database=PG_DATABASE,
            query={
                "sslmode": "verify-full",
                "sslnegotiation": "direct",  # required: the nginx port only speaks direct TLS
                "sslrootcert": certifi.where(),
            },
        )
    return create_engine(url, pool_pre_ping=True)


def _quote(value: str) -> str:
    # Braces keep ';' or '=' in a password from breaking the connection string.
    return "{" + value.replace("}", "}}") + "}"


def get_ait_engine():
    load_dotenv()
    missing = [name for name in ("AIT_USERNAME", "AIT_PASSWORD") if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")

    conn_str = (
        f"Server={AIT_SERVER};"
        f"Database={AIT_DATABASE};"
        f"UID={_quote(os.environ['AIT_USERNAME'])};"
        f"PWD={_quote(os.environ['AIT_PASSWORD'])};"
        "Encrypt=yes;"
    )

    return create_engine("mssql+mssqlpython://", creator=lambda: mssql_python.connect(conn_str))
