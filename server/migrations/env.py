from alembic import context
from app.db import engine

def run():
    db = engine()
    try:
        with db.connect() as conn:
            context.configure(connection=conn, version_table_schema='store')
            with context.begin_transaction():
                context.run_migrations()
    finally:
        db.dispose()

if context.is_offline_mode():
    raise RuntimeError('offline migrations disabled')
run()
