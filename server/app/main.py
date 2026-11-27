from fastapi import FastAPI
from fastapi.responses import JSONResponse, HTMLResponse
from sqlalchemy import text
from app.db import engine

app = FastAPI(title='SOYUZ Store foundation', docs_url=None, redoc_url=None, openapi_url=None)
REVISION = '0001_foundation'

def readiness():
    db = engine()
    try:
        with db.connect() as conn:
            revision = conn.execute(text('SELECT version_num FROM store.alembic_version')).scalar_one()
            if revision != REVISION:
                raise RuntimeError('schema mismatch')
        return True
    except Exception:
        return False
    finally:
        db.dispose()

@app.get('/health/live')
def live():
    return {'status': 'ok', 'release': 'M314', 'sales_enabled': False}

@app.get('/health/ready')
def ready():
    ok = readiness()
    return JSONResponse({'status': 'ok' if ok else 'unavailable', 'release': 'M314', 'sales_enabled': False}, status_code=200 if ok else 503)

@app.get('/', response_class=HTMLResponse)
def index():
    return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>SOYUZ Store</title><h1>SOYUZ MUSIC</h1><p>Инфраструктура M314. Продажи отключены.</p></html>'
