"""Private VPN preview: mail queue enabled after M350 qualification."""
import os
import re
from app.db import engine
from app.account_http import create_app
from app.mail_service import MailQueue

def key(name):
    value=os.environ.get(name,"")
    if not re.fullmatch(r"[0-9a-f]{64}",value): raise RuntimeError("auth configuration missing")
    return bytes.fromhex(value)

rate=key("STORE_AUTH_RATE_KEY")
mail=key("STORE_AUTH_MAIL_KEY")
if rate==mail: raise RuntimeError("auth keys must differ")
account_app=create_app(engine(),"https://shop.soyuz-music.ru",rate,MailQueue({"v1":mail},"v1"),prefix="",mail_enabled=True)
