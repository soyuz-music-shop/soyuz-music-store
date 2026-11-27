import os
from sqlalchemy import create_engine
from sqlalchemy.engine import URL

def url():
    return URL.create('postgresql+psycopg', username=os.environ['DB_USER'], password=os.environ['DB_PASSWORD'], host=os.environ['DB_HOST'], database=os.environ['DB_NAME'])

def engine():
    return create_engine(url(), pool_pre_ping=True, pool_size=2, max_overflow=1, connect_args={'connect_timeout': 3, 'options': '-c statement_timeout=3000'})
