FROM python:3.11.17-slim-bookworm@sha256:0a310eeecf4e1f5a0743f9a6520c90c88d089c903ca5fd283f501e3a805f5f89 AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY requirements.txt requirements.lock ./
# /dev/null is an explicit opt-out used only when refreshing the Linux lock.
ARG LOCK_FILE=requirements.lock
RUN python -m pip install --only-binary=:all: -r requirements.txt -c "${LOCK_FILE}" && python -m pip check
COPY --chown=app:app app ./app
USER app
RUN python -c "from app.main import app; assert app.title == 'TalentFlow AI'"

FROM base AS test
COPY --chown=app:app tests ./tests
CMD ["python", "-m", "pytest", "-p", "no:cacheprovider"]

FROM base AS runtime
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
