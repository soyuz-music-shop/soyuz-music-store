import time
from sqlalchemy import text
from app.db import engine

def main():
    db = engine()
    while True:
        try:
            with db.begin() as conn:
                conn.execute(text("INSERT INTO store.worker_heartbeat (id, seen_at) VALUES (1, now()) ON CONFLICT (id) DO UPDATE SET seen_at = excluded.seen_at"))
        except Exception:
            print('M296_WORKER_DB_UNAVAILABLE', flush=True)
        time.sleep(10)

if __name__ == '__main__':
    main()
