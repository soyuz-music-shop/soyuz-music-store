from fastapi import FastAPI
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from sqlalchemy import text
from app.db import engine
from app.catalog import router as catalog_router

app = FastAPI(title='SOYUZ Store foundation', docs_url=None, redoc_url=None, openapi_url=None)
REVISION = '0001_foundation'
app.include_router(catalog_router)

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
    return {'status': 'ok', 'release': 'M327', 'sales_enabled': False}

@app.get('/health/ready')
def ready():
    ok = readiness()
    return JSONResponse({'status': 'ok' if ok else 'unavailable', 'release': 'M327', 'sales_enabled': False}, status_code=200 if ok else 503)

STOREFRONT = Path(__file__).resolve().parent / 'storefront'
app.mount('/assets', StaticFiles(directory=STOREFRONT / 'assets'), name='storefront-assets')

@app.get('/')
def index():
    return FileResponse(STOREFRONT / 'index.html', media_type='text/html', headers={'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://ir.ozone.ru; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff'})
