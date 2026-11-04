"""static_data.fetched: when each static_data table was last fetched from its source. The dashboard shows it."""
from sqlalchemy import text


def record_fetched(db, table, fetched_at=None):
    """Call it in the transaction that writes static_data.<table>. fetched_at defaults to now."""
    db.execute(
        text("INSERT INTO static_data.fetched VALUES (:table, coalesce(CAST(:at AS timestamptz), now()))"
             " ON CONFLICT (table_name) DO UPDATE SET fetched_at = EXCLUDED.fetched_at"),
        {"table": table, "at": fetched_at},
    )
