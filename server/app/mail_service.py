"""M340 candidate. No cleartext action token in the queue; separate durable secret required."""
import base64
import hashlib
import hmac
import re
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from urllib.parse import urlsplit
from sqlalchemy import text
from app import account_service as svc
from app.auth_security import token_digest, normalize_email

PURPOSES = {'verify_email': ('Подтверждение электронной почты', 'verify'),
            'reset_password': ('Восстановление пароля', 'reset'),
            'change_email': ('Подтверждение нового адреса', 'change-email')}

class MailQueue:
    def __init__(self, keys, active_key):
        if active_key not in keys or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', k) or not isinstance(v, bytes) or len(v) < 32 for k,v in keys.items()):
            raise ValueError('invalid mail key configuration')
        self.keys = dict(keys)
        self.active_key = active_key

    def token(self, job_id, purpose, key_id):
        if purpose not in PURPOSES:
            raise ValueError('purpose')
        raw = hmac.new(self.keys[key_id], b'soyuz-mail-v1\0'+uuid.UUID(str(job_id)).bytes+b'\0'+purpose.encode('ascii'), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')

    def enqueue(self, c, email, purpose):
        job = uuid.uuid4()
        raw = self.token(job,purpose,self.active_key)
        if purpose == 'verify_email':
            issued = svc.register(c,email,raw)
        elif purpose == 'reset_password':
            issued = svc.request_reset(c,email,raw)
        else:
            raise ValueError('purpose')
        if issued is None:
            return None
        c.execute(text('INSERT INTO store.customer_mail_outbox(id,token_digest,key_id) VALUES (:id,:d,:k)'), {'id':job,'d':token_digest(issued),'k':self.active_key})
        return job

    def enqueue_change(self,c,raw,csrf,password,email):
        job=uuid.uuid4()
        action=self.token(job,'change_email',self.active_key)
        result=svc.request_email_change(c,raw,csrf,password,email,action)
        if result=='ok':
            c.execute(text('INSERT INTO store.customer_mail_outbox(id,token_digest,key_id) VALUES (:id,:d,:k)'), {'id':job,'d':token_digest(action),'k':self.active_key})
        return result

    def process_one(self, db, deliver):
        # Single row locked until bounded SMTP attempt completes. Other workers skip it.
        # A crash after SMTP acceptance but before commit may duplicate delivery; same token/message ID.
        with db.begin() as c:
            row=c.execute(text('''SELECT o.id,o.key_id,o.attempts,o.token_digest,t.purpose,t.target_email,
              (t.expires_at > clock_timestamp()+interval '60 seconds' AND t.consumed_at IS NULL AND t.revoked_at IS NULL
                AND a.disabled_at IS NULL AND (CASE WHEN t.purpose='change_email' THEN a.email_verified_at IS NOT NULL AND a.email<>t.target_email ELSE a.email=t.target_email END)) AS usable
              FROM store.customer_mail_outbox o JOIN store.customer_action_tokens t USING(token_digest)
              JOIN store.customer_accounts a ON a.id=t.account_id
              WHERE o.state='pending' AND o.next_attempt_at<=clock_timestamp()
              ORDER BY o.next_attempt_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED''')).mappings().one_or_none()
            if row is None:
                return self.process_notice(c,deliver)
            n=row['attempts']+1
            if not row['usable']:
                state='expired'; n=row['attempts']
            elif row['key_id'] not in self.keys:
                # Configuration fault. Leave pending; do not silently discard a valid message.
                raise RuntimeError('mail key unavailable')
            else:
                raw=self.token(row['id'],row['purpose'],row['key_id'])
                if not hmac.compare_digest(token_digest(raw),row['token_digest']):
                    raise RuntimeError('mail key mismatch')
                try:
                    deliver(row['target_email'],row['purpose'],raw,row['id'])
                except (OSError,smtplib.SMTPException):
                    state='failed' if n>=5 else 'pending'
                else:
                    state='sent'
            c.execute(text('''UPDATE store.customer_mail_outbox SET state=:s,attempts=:n,
                next_attempt_at=clock_timestamp()+make_interval(secs=>:delay),
                finished_at=CASE WHEN :s='pending' THEN NULL ELSE clock_timestamp() END WHERE id=:id'''),
                {'s':state,'n':n,'delay':min(300,15*2**max(0,n-1)),'id':row['id']})
            return state

    def process_notice(self,c,deliver):
        row=c.execute(text("""SELECT id,recipient,attempts,created_at > clock_timestamp()-interval '24 hours' AS usable
            FROM store.customer_security_notices WHERE state='pending' AND next_attempt_at<=clock_timestamp()
            ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED""")).mappings().one_or_none()
        if row is None: return 'idle'
        n=row['attempts']
        if not row['usable']:
            state='expired'
        else:
            n+=1
            try:
                deliver(row['recipient'],'email_changed',None,row['id'])
            except (OSError,smtplib.SMTPException):
                state='failed' if n>=5 else 'pending'
            else: state='sent'
        c.execute(text("""UPDATE store.customer_security_notices SET state=:s,attempts=:n,
            recipient=CASE WHEN :s='pending' THEN recipient ELSE NULL END,
            next_attempt_at=clock_timestamp()+make_interval(secs=>:delay),
            finished_at=CASE WHEN :s='pending' THEN NULL ELSE clock_timestamp() END WHERE id=:id"""),
            {'s':state,'n':n,'delay':min(300,15*2**max(0,n-1)),'id':row['id']})
        return state

class SMTPTransport:
    def __init__(self, host, port, mode, sender, username, password, origin):
        u=urlsplit(origin)
        if u.scheme!='https' or not u.hostname or u.username or u.password or u.path or u.query or u.fragment or origin!='https://shop.soyuz-music.ru':
            raise ValueError('origin')
        if mode not in ('ssl','starttls') or type(port) is not int or not 1<=port<=65535 or not host or not username or not password:
            raise ValueError('smtp configuration')
        self.host,self.port,self.mode=host,port,mode
        self.sender=normalize_email(sender);self.username=username;self.password=password;self.origin=origin

    def message(self, email, purpose, raw, job):
        if purpose=='email_changed':
            if raw is not None: raise ValueError('notice must not contain token')
            msg=EmailMessage();msg['From']=self.sender;msg['To']=normalize_email(email)
            msg['Subject']='Изменение электронной почты — SOYUZ MUSIC';msg['Message-ID']=f'<{uuid.UUID(str(job))}@shop.soyuz-music.ru>'
            msg.set_content('Электронная почта вашего аккаунта SOYUZ MUSIC изменена. Если вы не меняли адрес, свяжитесь с поддержкой магазина через официальный сайт.\n\n'+self.origin+'\n\nSOYUZ MUSIC')
            return msg
        token_digest(raw)
        subject,action=PURPOSES[purpose]
        msg=EmailMessage();msg['From']=self.sender;msg['To']=normalize_email(email)
        msg['Subject']=subject+' — SOYUZ MUSIC';msg['Message-ID']=f'<{uuid.UUID(str(job))}@shop.soyuz-music.ru>'
        link=f'{self.origin}/account.html#{action}={raw}'
        ttl='30 минут' if purpose=='reset_password' else '24 часа'
        msg.set_content(f'{subject}\n\nПерейдите по ссылке:\n{link}\n\nСрок действия ссылки: {ttl} с момента запроса.\nЕсли вы не отправляли запрос, проигнорируйте письмо.\n\nSOYUZ MUSIC')
        return msg

    def __call__(self,email,purpose,raw,job):
        msg=self.message(email,purpose,raw,job)
        ctx=ssl.create_default_context()
        if self.mode=='ssl':
            smtp=smtplib.SMTP_SSL(self.host,self.port,timeout=8,context=ctx)
        else:
            smtp=smtplib.SMTP(self.host,self.port,timeout=8)
        try:
            if self.mode=='starttls':
                smtp.ehlo();smtp.starttls(context=ctx);smtp.ehlo()
            smtp.login(self.username,self.password)
            if smtp.send_message(msg):
                raise smtplib.SMTPException('delivery refused')
        finally:
            # Closing the connection after DATA acceptance must not turn success into failure.
            smtp.close()
