"""M337 candidate: auth primitives, not an HTTP API. Never log inputs or secrets."""
from datetime import timedelta
import hashlib
import hmac
import re
import secrets
import threading
from argon2 import PasswordHasher, Type, extract_parameters
from argon2.exceptions import InvalidHashError, VerificationError

PASSWORD_MIN = 12
PASSWORD_MAX = 128
# Bound concurrent CPU/memory consumption; API must also rate-limit before hashing.
_HASH_SLOTS = threading.BoundedSemaphore(2)
_HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)
SESSION_COOKIE = '__Host-soyuz-session'
ACTION_TTL = {'verify_email': timedelta(hours=24), 'reset_password': timedelta(minutes=30), 'change_email': timedelta(hours=24)}

class AuthBusy(Exception): pass


def normalize_email(value):
    if not isinstance(value, str): raise ValueError('invalid email')
    v = value.strip().lower()
    if len(v) > 254 or v.count('@') != 1: raise ValueError('invalid email')
    local, domain = v.rsplit('@', 1)
    if not re.fullmatch(r"[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}", local) or local.startswith('.') or local.endswith('.') or '..' in local:
        raise ValueError('invalid email')
    try: domain = domain.encode('idna').decode('ascii')
    except UnicodeError: raise ValueError('invalid email') from None
    if len(domain) > 253 or '.' not in domain or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', p) for p in domain.split('.')):
        raise ValueError('invalid email')
    result=local+'@'+domain
    if len(result)>254: raise ValueError('invalid email')
    return result


def validate_password(password):
    if not isinstance(password, str) or not PASSWORD_MIN <= len(password) <= PASSWORD_MAX or '\0' in password:
        raise ValueError('invalid password length')
    if len(password.encode('utf-8')) > 512: raise ValueError('invalid password length')
    return password


def _with_slot(fn):
    if not _HASH_SLOTS.acquire(timeout=0.1): raise AuthBusy('password service busy')
    try: return fn()
    finally: _HASH_SLOTS.release()


def hash_password(password):
    return _with_slot(lambda: _HASHER.hash(validate_password(password)))


def verify_password(encoded, password):
    try:
        validate_password(password)
        if not isinstance(encoded,str) or len(encoded)>512: return False
        p=extract_parameters(encoded)
        # Reject malformed/foreign parameter sets before allocating memory.
        if p.type is not Type.ID or p.version != 19 or not (8192<=p.memory_cost<=65536 and 1<=p.time_cost<=4 and 1<=p.parallelism<=2 and 16<=p.salt_len<=64 and 16<=p.hash_len<=64): return False
        return _with_slot(lambda: _HASHER.verify(encoded,password))
    except (ValueError, InvalidHashError, VerificationError): return False


def new_token():
    return secrets.token_urlsafe(32)


def token_digest(token):
    if not isinstance(token,str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}',token): raise ValueError('invalid token')
    return hashlib.sha256(token.encode('ascii')).hexdigest()


def csrf_matches(raw, stored_digest):
    try: return isinstance(stored_digest,str) and hmac.compare_digest(token_digest(raw),stored_digest)
    except ValueError: return False


def rate_bucket(key, purpose, identifier):
    if not isinstance(key,bytes) or len(key)<32 or purpose not in ('login_email','login_ip','register_ip','verify_email','reset_email','reset_ip','redeem_ip','profile_account','change_password_account','change_password_global','change_email_account','change_email_global','delete_account','delete_global') or not isinstance(identifier,str) or not 1<=len(identifier)<=512:
        raise ValueError('invalid rate bucket')
    return hmac.new(key,(purpose+'\0'+identifier).encode('utf-8'),hashlib.sha256).hexdigest()


def session_ttl(remember):
    return timedelta(days=30) if remember is True else timedelta(hours=12)


def cookie_options(remember):
    return {'secure': True, 'httponly': True, 'samesite': 'lax', 'path': '/', 'max_age': 30*24*60*60 if remember is True else None}
