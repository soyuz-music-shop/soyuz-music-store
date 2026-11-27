import sys
import urllib.request
from sqlalchemy import text
from app.db import engine

def main():
    if sys.argv[1] == 'web':
        with urllib.request.urlopen('http://127.0.0.1:8080/health/ready', timeout=4) as response:
            return 0 if response.status == 200 else 1
    if sys.argv[1] != 'worker':
        return 2
    db = engine()
    try:
        with db.connect() as conn:
            return 0 if conn.execute(text("SELECT seen_at > now() - interval '45 seconds' FROM store.worker_heartbeat WHERE id = 1")).scalar_one_or_none() else 1
    finally:
        db.dispose()

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        sys.exit(1)
