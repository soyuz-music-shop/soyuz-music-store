import os
import re

from sync_ozon import send_waitlist_email


recipient = os.environ.get("TEST_EMAIL_RECIPIENT", "").strip()
if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", recipient):
    raise SystemExit("TEST_EMAIL_RECIPIENT must contain a valid email address")

subject = "Снова в наличии"
text_body = """Здравствуйте!

Это тестовое письмо от интернет-магазина Союз Мьюзик. Уведомления о поступлении подключены и работают.

С любовью к музыке,
команда Союз Мьюзик.
"""
html_body = """<p>Здравствуйте!</p>
<p>Это тестовое письмо от интернет-магазина <strong>Союз Мьюзик</strong>. Уведомления о поступлении подключены и работают.</p>
<p>С любовью к музыке,<br>команда Союз Мьюзик.</p>
"""

provider = send_waitlist_email(recipient, subject, html_body, text_body)
print(f"Test email sent to {recipient} via {provider}")
