"""Transactional e-mail (verification, reset, registration notice).

Decision D8: no external provider in v1. Compose sends to a local Mailpit;
tests use the in-memory outbox. Message bodies are never logged.
"""

import smtplib
from dataclasses import dataclass
from email.message import EmailMessage

from app.core.config import Settings


@dataclass(frozen=True)
class Mail:
    to: str
    subject: str
    body: str


outbox: list[Mail] = []

TEMPLATES = {
    "verify_email": {
        "fr": ("Confirmez votre adresse e-mail", "Bonjour,\n\nConfirmez votre adresse pour activer votre compte TalentFlow AI :\n{link}\n\nCe lien expire dans 24 heures. Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.\n\nVersion de démonstration : n'utilisez que des données fictives."),
        "en": ("Confirm your e-mail address", "Hello,\n\nConfirm your address to activate your TalentFlow AI account:\n{link}\n\nThis link expires in 24 hours. If you did not sign up, ignore this message.\n\nDemo version: use fictional data only."),
    },
    "reset_password": {
        "fr": ("Réinitialisez votre mot de passe", "Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien :\n{link}\n\nIl expire dans 30 minutes. Toutes vos sessions seront fermées. Si vous n'avez rien demandé, ignorez ce message."),
        "en": ("Reset your password", "Hello,\n\nTo choose a new password, open this link:\n{link}\n\nIt expires in 30 minutes. All your sessions will be signed out. If you did not ask for this, ignore this message."),
    },
    "already_registered": {
        "fr": ("Tentative d'inscription avec votre adresse", "Bonjour,\n\nQuelqu'un a essayé de créer un compte TalentFlow AI avec votre adresse, qui en possède déjà un. Pour vous connecter : {link}\n\nMot de passe oublié ? Utilisez « Mot de passe oublié » sur la page de connexion. Si ce n'était pas vous, ignorez ce message."),
        "en": ("Sign-up attempt with your address", "Hello,\n\nSomeone tried to create a TalentFlow AI account with your address, which already has one. To sign in: {link}\n\nForgot your password? Use \"Forgot password\" on the sign-in page. If this was not you, ignore this message."),
    },
}


def send(settings: Settings, to: str, template: str, locale: str, link: str) -> None:
    subject, body = TEMPLATES[template]["en" if locale == "en" else "fr"]
    mail = Mail(to=to, subject=subject, body=body.format(link=link))
    if settings.email_backend == "memory":
        outbox.append(mail)
        return
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = mail.to
    message["Subject"] = mail.subject
    message.set_content(mail.body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        smtp.send_message(message)
