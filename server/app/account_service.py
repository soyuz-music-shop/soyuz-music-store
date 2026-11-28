"""Candidate transactional account service. Supports caller-supplied action token for atomic mail enqueue.
Not mounted in the live API. Never log passwords, tokens or email addresses.
"""
import uuid
from sqlalchemy import text
from app.auth_security import (normalize_email, validate_password, hash_password, verify_password,
                           new_token, token_digest, csrf_matches, rate_bucket, ACTION_TTL, session_ttl)


def run(c, sql, **p):
    return c.execute(text(sql), p)


def throttle(c, key, purpose, identifier, limit, seconds):
    """Commit this transaction even on rejection, before expensive password work."""
    d = rate_bucket(key, purpose, identifier)
    n = run(c, '''INSERT INTO store.customer_auth_rate_limits(bucket_digest, attempts, window_until)
      VALUES (:d,1,now()+make_interval(secs=>:seconds))
      ON CONFLICT(bucket_digest) DO UPDATE SET
        attempts=CASE WHEN customer_auth_rate_limits.window_until<=now() THEN 1 ELSE least(customer_auth_rate_limits.attempts+1,1000000) END,
        window_until=CASE WHEN customer_auth_rate_limits.window_until<=now() THEN now()+make_interval(secs=>:seconds) ELSE customer_auth_rate_limits.window_until END
      RETURNING attempts''', d=d,seconds=seconds).scalar_one()
    return n <= limit


def account(c, email):
    return run(c, 'SELECT * FROM store.customer_accounts WHERE email=:email FOR UPDATE',email=email).mappings().one_or_none()


def issue(c, a, purpose, raw=None):
    # Account row locked by caller; do not invalidate links on unauthenticated resend.
    raw=new_token() if raw is None else raw
    run(c, '''INSERT INTO store.customer_action_tokens(token_digest,account_id,purpose,target_email,created_at,expires_at)
        VALUES (:d,:id,:purpose,:email,now(),now()+make_interval(secs=>:ttl))''',d=token_digest(raw),id=a['id'],purpose=purpose,email=a['email'],ttl=ACTION_TTL[purpose].total_seconds())
    return raw


def register(c,email,raw=None):
    # Mailbox ownership precedes setting the password, preventing pre-registration hijack.
    email=normalize_email(email)
    run(c, '''INSERT INTO store.customer_accounts(id,email,display_name,password_hash)
        VALUES (:id,:email,'Pending',:h) ON CONFLICT(email) DO NOTHING''',id=uuid.uuid4(),email=email,h='$argon2id$pending-no-login')
    a=account(c,email)
    return issue(c,a,'verify_email',raw) if a and not a['email_verified_at'] and not a['disabled_at'] else None


def redeem(c,raw,purpose,password,display_name=None):
    validate_password(password)
    if purpose not in ('verify_email','reset_password'): raise ValueError('purpose')
    if purpose=='verify_email' and (not isinstance(display_name,str) or not 1<=len(display_name.strip())<=80): raise ValueError('name')
    try: d=token_digest(raw)
    except ValueError: return False
    candidate=run(c,'SELECT account_id FROM store.customer_action_tokens WHERE token_digest=:d AND purpose=:p',d=d,p=purpose).scalar_one_or_none()
    if candidate is None: return False
    a=run(c,'SELECT * FROM store.customer_accounts WHERE id=:id FOR UPDATE',id=candidate).mappings().one_or_none()
    if not a or a['disabled_at'] or bool(a['email_verified_at'])!=(purpose=='reset_password'): return False
    t=run(c,'''SELECT 1 FROM store.customer_action_tokens WHERE token_digest=:d AND account_id=:id AND purpose=:p AND target_email=:email
       AND expires_at>clock_timestamp() AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE''',d=d,id=a['id'],p=purpose,email=a['email']).scalar_one_or_none()
    if not t: return False
    h=hash_password(password)
    changed=run(c,'''UPDATE store.customer_action_tokens SET consumed_at=clock_timestamp() WHERE token_digest=:d AND expires_at>clock_timestamp()
       AND consumed_at IS NULL AND revoked_at IS NULL RETURNING token_digest''',d=d).scalar_one_or_none()
    if not changed: return False
    if purpose=='verify_email':
        run(c,'''UPDATE store.customer_accounts SET password_hash=:h,display_name=:name,email_verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=:id''',h=h,name=display_name.strip(),id=a['id'])
    else:
        run(c,'UPDATE store.customer_accounts SET password_hash=:h,updated_at=clock_timestamp() WHERE id=:id',h=h,id=a['id'])
    run(c,'UPDATE store.customer_action_tokens SET revoked_at=clock_timestamp() WHERE account_id=:id AND consumed_at IS NULL AND revoked_at IS NULL',id=a['id'])
    run(c,'UPDATE store.customer_sessions SET revoked_at=clock_timestamp() WHERE account_id=:id AND revoked_at IS NULL',id=a['id'])
    return True


def request_reset(c,email,raw=None):
    a=account(c,normalize_email(email))
    return issue(c,a,'reset_password',raw) if a and a['email_verified_at'] and not a['disabled_at'] else None


def login(c,email,password,remember,dummy_hash):
    validate_password(password)
    a=account(c,normalize_email(email))
    eligible=bool(a and a['email_verified_at'] and not a['disabled_at'])
    good=verify_password(a['password_hash'] if eligible else dummy_hash,password)
    if not eligible or not good: return None
    raw,csrf=new_token(),new_token()
    run(c,'''INSERT INTO store.customer_sessions(token_digest,account_id,csrf_digest,created_at,expires_at)
        VALUES (:d,:id,:csrf,now(),now()+make_interval(secs=>:ttl))''',d=token_digest(raw),id=a['id'],csrf=token_digest(csrf),ttl=session_ttl(remember).total_seconds())
    return raw,csrf


def session(c,raw):
    try: d=token_digest(raw)
    except ValueError: return None
    return run(c,'''SELECT a.id,a.email,a.display_name,a.phone,a.phone_verified_at,s.csrf_digest,s.token_digest FROM store.customer_sessions s
        JOIN store.customer_accounts a ON a.id=s.account_id WHERE s.token_digest=:d AND s.revoked_at IS NULL
        AND s.expires_at>clock_timestamp() AND a.disabled_at IS NULL AND a.email_verified_at IS NOT NULL''',d=d).mappings().one_or_none()


def logout(c,raw,csrf):
    s=session(c,raw)
    if not s or not csrf_matches(csrf,s['csrf_digest']): return False
    run(c,'UPDATE store.customer_sessions SET revoked_at=clock_timestamp() WHERE token_digest=:d AND revoked_at IS NULL',d=s['token_digest'])
    return True


def locked_session(c, raw, csrf):
    s=session(c,raw)
    if not s or not csrf_matches(csrf,s['csrf_digest']): return None
    a=run(c,'SELECT * FROM store.customer_accounts WHERE id=:id FOR UPDATE',id=s['id']).mappings().one_or_none()
    # Account lock serializes with login/reset/redeem. Revalidate session after waiting.
    current=session(c,raw)
    if not a or not current or current['id']!=a['id'] or not csrf_matches(csrf,current['csrf_digest']): return None
    return a


def update_profile(c,raw,csrf,name,phone):
    import re
    if not isinstance(name,str) or not 1<=len(name.strip())<=80 or any(ord(ch)<32 for ch in name): raise ValueError('name')
    if phone is not None and (not isinstance(phone,str) or not re.fullmatch(r'\+[1-9][0-9]{7,14}',phone)): raise ValueError('phone')
    a=locked_session(c,raw,csrf)
    if not a: return False
    run(c,'''UPDATE store.customer_accounts SET display_name=:name,phone=:phone,
        phone_verified_at=CASE WHEN phone IS NOT DISTINCT FROM CAST(:phone AS text) THEN phone_verified_at ELSE NULL END,
        updated_at=clock_timestamp() WHERE id=:id''',name=name.strip(),phone=phone,id=a['id'])
    return True


def change_password(c,raw,csrf,old,new):
    validate_password(old);validate_password(new)
    a=locked_session(c,raw,csrf)
    if not a: return 'forbidden'
    if not verify_password(a['password_hash'],old): return 'invalid_credentials'
    h=hash_password(new)
    run(c,'UPDATE store.customer_accounts SET password_hash=:h,updated_at=clock_timestamp() WHERE id=:id',h=h,id=a['id'])
    run(c,'UPDATE store.customer_action_tokens SET revoked_at=clock_timestamp() WHERE account_id=:id AND consumed_at IS NULL AND revoked_at IS NULL',id=a['id'])
    run(c,'UPDATE store.customer_sessions SET revoked_at=clock_timestamp() WHERE account_id=:id AND revoked_at IS NULL',id=a['id'])
    return 'ok'


# New email ownership is established before changing the login.
def request_email_change(c, raw, csrf, password, email, action_raw):
    email=normalize_email(email); validate_password(password)
    a=locked_session(c,raw,csrf)
    if not a: return 'forbidden'
    if not verify_password(a['password_hash'],password): return 'invalid_credentials'
    if email==a['email'] or run(c,'SELECT 1 FROM store.customer_accounts WHERE email=:email',email=email).scalar_one_or_none(): return 'unavailable_email'
    run(c,"UPDATE store.customer_action_tokens SET revoked_at=clock_timestamp() WHERE account_id=:id AND purpose='change_email' AND consumed_at IS NULL AND revoked_at IS NULL",id=a['id'])
    issue(c,{'id':a['id'],'email':email},'change_email',action_raw)
    return 'ok'


def confirm_email_change(c, raw, password):
    from sqlalchemy.exc import IntegrityError
    validate_password(password)
    try: digest=token_digest(raw)
    except ValueError: return False
    aid=run(c,"SELECT account_id FROM store.customer_action_tokens WHERE token_digest=:d AND purpose='change_email'",d=digest).scalar_one_or_none()
    if aid is None: return False
    a=run(c,'SELECT * FROM store.customer_accounts WHERE id=:id FOR UPDATE',id=aid).mappings().one_or_none()
    if not a or a['disabled_at'] or not a['email_verified_at']: return False
    target=run(c,"""SELECT target_email FROM store.customer_action_tokens WHERE token_digest=:d AND account_id=:id AND purpose='change_email'
        AND expires_at>clock_timestamp() AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE""",d=digest,id=aid).scalar_one_or_none()
    if not target or target==a['email'] or not verify_password(a['password_hash'],password): return False
    try:
        with c.begin_nested():
            changed=run(c,"""UPDATE store.customer_action_tokens SET consumed_at=clock_timestamp() WHERE token_digest=:d AND expires_at>clock_timestamp() AND consumed_at IS NULL AND revoked_at IS NULL RETURNING token_digest""",d=digest).scalar_one_or_none()
            if not changed: return False
            # The unique constraint is the final arbiter, including concurrent registrations.
            run(c,'UPDATE store.customer_accounts SET email=:email,email_verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=:id',email=target,id=aid)
    except IntegrityError:
        return False
    run(c,'UPDATE store.customer_action_tokens SET revoked_at=clock_timestamp() WHERE account_id=:id AND consumed_at IS NULL AND revoked_at IS NULL',id=aid)
    run(c,'UPDATE store.customer_sessions SET revoked_at=clock_timestamp() WHERE account_id=:id AND revoked_at IS NULL',id=aid)
    # Commit the notice to the old mailbox atomically with the email change.
    run(c, 'INSERT INTO store.customer_security_notices(id,account_id,recipient) VALUES (:job,:id,:email)',job=uuid.uuid4(),id=aid,email=a['email'])
    return True


def delete_account(c, raw, csrf, password):
    # Only for the pre-commerce customer schema. Revisit retention before orders go live.
    validate_password(password)
    a=locked_session(c,raw,csrf)
    if not a: return 'forbidden'
    if not verify_password(a['password_hash'],password): return 'invalid_credentials'
    # FK cascades remove sessions, action tokens, their mail jobs, and security notices.
    # Rate-limit digests are retained until their ordinary expiry, preventing immediate abuse.
    deleted=run(c,'DELETE FROM store.customer_accounts WHERE id=:id RETURNING id',id=a['id']).scalar_one_or_none()
    return 'ok' if deleted else 'forbidden'
