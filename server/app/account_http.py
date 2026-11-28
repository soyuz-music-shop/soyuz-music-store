"""M339 candidate HTTP boundary. Not registered in live Store. Mail enqueue is injected; runs in the account transaction."""
import json
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from app.auth_security import (AuthBusy, SESSION_COOKIE, cookie_options, normalize_email,
                           validate_password, hash_password, new_token)
from app import account_service as svc

CSRF_COOKIE = '__Host-soyuz-csrf'
GENERIC = {'ok': True, 'message': 'If eligible, an email will be sent.'}

class Rejected(Exception):
    def __init__(self, status): self.status=status


def create_app(db, origin, rate_key, mail, *, prefix="/api/v1/account", mail_enabled=True):
    if not origin.startswith('https://') or origin.endswith('/') or len(rate_key)<32:
        raise ValueError('configuration')
    app=FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    dummy=hash_password(new_token())

    def reply(data, status=200):
        return JSONResponse(data, status_code=status, headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'})

    @app.exception_handler(Rejected)
    async def rejected(request, exc):
        return reply({'ok':False,'error':{400:'invalid_request',403:'forbidden',413:'request_too_large',415:'unsupported_media',429:'too_many_requests'}.get(exc.status,'unavailable')},exc.status)
    @app.exception_handler(ValueError)
    async def invalid(request, exc): return reply({'ok':False,'error':'invalid_request'},400)
    @app.exception_handler(AuthBusy)
    @app.exception_handler(SQLAlchemyError)
    async def busy(request, exc): return reply({'ok':False,'error':'unavailable'},503)

    async def payload(req, fields):
        if req.headers.get('origin')!=origin: raise Rejected(403)
        if req.headers.get('content-type','').split(';',1)[0].strip().lower()!='application/json': raise Rejected(415)
        body=bytearray()
        async for chunk in req.stream():
            if len(body)+len(chunk)>8192: raise Rejected(413)
            body.extend(chunk)
        try: d=json.loads(body)
        except (ValueError,UnicodeError): raise Rejected(400) from None
        if not isinstance(d,dict) or set(d)!=set(fields): raise Rejected(400)
        return d

    def limit_sync(purpose, identifier, n, seconds):
        # Committed even if denied. No reliance on untrusted forwarding headers.
        with db.begin() as c: allowed=svc.throttle(c,rate_key,purpose,identifier,n,seconds)
        if not allowed: raise Rejected(429)

    async def limit(*args):
        await run_in_threadpool(limit_sync, *args)

    @app.post(prefix+'/register')
    async def register(req: Request):
        if not mail_enabled: return reply({'ok':False,'error':'unavailable'},503)
        d=await payload(req,('email',)); email=normalize_email(d['email'])
        await limit('register_ip','global',60,60); await limit('verify_email',email,3,900)
        def work():
            with db.begin() as c: mail.enqueue(c,email,'verify_email')
        await run_in_threadpool(work)
        return reply(GENERIC,202)

    @app.post(prefix+'/reset-request')
    async def reset_request(req: Request):
        if not mail_enabled: return reply({'ok':False,'error':'unavailable'},503)
        d=await payload(req,('email',)); email=normalize_email(d['email'])
        await limit('reset_ip','global',60,60); await limit('reset_email',email,3,900)
        def work():
            with db.begin() as c: mail.enqueue(c,email,'reset_password')
        await run_in_threadpool(work)
        return reply(GENERIC,202)

    async def redeem(req,purpose):
        if not mail_enabled: return reply({'ok':False,'error':'unavailable'},503)
        d=await payload(req,('token','password','name') if purpose=='verify_email' else ('token','password'))
        validate_password(d['password']); await limit('redeem_ip','global',30,60)
        def work():
            with db.begin() as c: return svc.redeem(c,d['token'],purpose,d['password'],d.get('name'))
        ok=await run_in_threadpool(work)
        return reply({'ok':ok} if ok else {'ok':False,'error':'invalid_or_expired_link'},200 if ok else 400)

    @app.post(prefix+'/verify')
    async def verify(req:Request): return await redeem(req,'verify_email')
    @app.post(prefix+'/reset')
    async def reset(req:Request): return await redeem(req,'reset_password')

    @app.post(prefix+'/login')
    async def login(req:Request):
        d=await payload(req,('email','password','remember')); email=normalize_email(d['email'])
        validate_password(d['password'])
        if type(d['remember']) is not bool: raise Rejected(400)
        await limit('login_ip','global',60,60); await limit('login_email',email,8,900)
        def work():
            with db.begin() as c: return svc.login(c,email,d['password'],d['remember'],dummy)
        result=await run_in_threadpool(work)
        if not result: return reply({'ok':False,'error':'invalid_credentials'},401)
        raw,csrf=result; res=reply({'ok':True}); options=cookie_options(d['remember'])
        res.set_cookie(SESSION_COOKIE,raw,**options)
        res.set_cookie(CSRF_COOKIE,csrf,**{**options,'httponly':False})
        return res

    @app.get(prefix+'/me')
    def me(req:Request):
        with db.begin() as c: s=svc.session(c,req.cookies.get(SESSION_COOKIE))
        if not s: return reply({'ok':False,'error':'unauthenticated'},401)
        return reply({'ok':True,'account':{'id':str(s['id']),'email':s['email'],'name':s['display_name'],'phone':s['phone'],'phone_verified':s['phone_verified_at'] is not None}})

    @app.post(prefix+'/logout')
    async def logout(req:Request):
        await payload(req,()); csrf=req.headers.get('x-csrf-token')
        def work():
            with db.begin() as c: return svc.logout(c,req.cookies.get(SESSION_COOKIE),csrf)
        if not await run_in_threadpool(work): raise Rejected(403)
        res=reply({'ok':True})
        res.delete_cookie(SESSION_COOKIE,path='/',secure=True,httponly=True,samesite='lax')
        res.delete_cookie(CSRF_COOKIE,path='/',secure=True,samesite='lax')
        return res
    def authorized_id(req):
        from app.auth_security import csrf_matches
        with db.begin() as c:
            s=svc.session(c,req.cookies.get(SESSION_COOKIE))
            if not s or not csrf_matches(req.headers.get('x-csrf-token'),s['csrf_digest']): raise Rejected(403)
            return str(s['id'])

    @app.post(prefix+'/profile')
    async def profile(req:Request):
        d=await payload(req,('name','phone'))
        aid=await run_in_threadpool(authorized_id,req)
        await limit('profile_account',aid,30,900)
        def work():
            with db.begin() as c: return svc.update_profile(c,req.cookies.get(SESSION_COOKIE),req.headers.get('x-csrf-token'),d['name'],d['phone'])
        if not await run_in_threadpool(work): raise Rejected(403)
        return reply({'ok':True})

    @app.post(prefix+'/change-password')
    async def change_password(req:Request):
        d=await payload(req,('old_password','new_password'))
        aid=await run_in_threadpool(authorized_id,req)
        validate_password(d['old_password']);validate_password(d['new_password'])
        await limit('change_password_global','global',30,60)
        await limit('change_password_account',aid,5,900)
        def work():
            with db.begin() as c: return svc.change_password(c,req.cookies.get(SESSION_COOKIE),req.headers.get('x-csrf-token'),d['old_password'],d['new_password'])
        result=await run_in_threadpool(work)
        if result=='forbidden': raise Rejected(403)
        if result!='ok': return reply({'ok':False,'error':'invalid_credentials'},401)
        res=reply({'ok':True})
        res.delete_cookie(SESSION_COOKIE,path='/',secure=True,httponly=True,samesite='lax')
        res.delete_cookie(CSRF_COOKIE,path='/',secure=True,samesite='lax')
        return res
    @app.post(prefix+'/change-email-request')
    async def change_email_request(req:Request):
        if not mail_enabled: return reply({'ok':False,'error':'unavailable'},503)
        d=await payload(req,('email','password')); email=normalize_email(d['email']);validate_password(d['password'])
        aid=await run_in_threadpool(authorized_id,req)
        await limit('change_email_global','global',30,60)
        await limit('change_email_account',aid,5,900)
        def work():
            with db.begin() as c: return mail.enqueue_change(c,req.cookies.get(SESSION_COOKIE),req.headers.get('x-csrf-token'),d['password'],email)
        result=await run_in_threadpool(work)
        if result=='forbidden': raise Rejected(403)
        if result=='invalid_credentials': return reply({'ok':False,'error':'invalid_credentials'},401)
        # Do not expose whether the requested mailbox belongs to another account.
        return reply(GENERIC,202)

    @app.post(prefix+'/change-email')
    async def confirm_email(req:Request):
        if not mail_enabled: return reply({'ok':False,'error':'unavailable'},503)
        d=await payload(req,('token','password'));validate_password(d['password'])
        await limit('redeem_ip','global',30,60)
        def work():
            with db.begin() as c: return svc.confirm_email_change(c,d['token'],d['password'])
        if not await run_in_threadpool(work): return reply({'ok':False,'error':'invalid_or_expired_link'},400)
        res=reply({'ok':True})
        res.delete_cookie(SESSION_COOKIE,path='/',secure=True,httponly=True,samesite='lax')
        res.delete_cookie(CSRF_COOKIE,path='/',secure=True,samesite='lax')
        return res
    @app.post(prefix+'/delete')
    async def delete_account(req:Request):
        d=await payload(req,('password','confirm'))
        if d['confirm'] is not True: raise Rejected(400)
        validate_password(d['password'])
        aid=await run_in_threadpool(authorized_id,req)
        await limit('delete_global','global',30,60)
        await limit('delete_account',aid,5,900)
        def work():
            with db.begin() as c: return svc.delete_account(c,req.cookies.get(SESSION_COOKIE),req.headers.get('x-csrf-token'),d['password'])
        result=await run_in_threadpool(work)
        if result=='forbidden': raise Rejected(403)
        if result!='ok': return reply({'ok':False,'error':'invalid_credentials'},401)
        res=reply({'ok':True})
        res.delete_cookie(SESSION_COOKIE,path='/',secure=True,httponly=True,samesite='lax')
        res.delete_cookie(CSRF_COOKIE,path='/',secure=True,samesite='lax')
        return res
    return app
