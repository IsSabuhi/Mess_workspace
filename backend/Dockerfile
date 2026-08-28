FROM python:3.12-slim

WORKDIR /app

# pg_dump должен быть >= версии сервера (у нас Postgres 18). Debian slim даёт 17 — берём клиент из PGDG.
# export — чтобы прокси действовал и на update, и на install (префикс VAR= действует только на первую команду).
RUN export http_proxy=http://172.24.231.73:8080 \
    https_proxy=http://172.24.231.73:8080 \
    HTTP_PROXY=http://172.24.231.73:8080 \
    HTTPS_PROXY=http://172.24.231.73:8080 \
    DEBIAN_FRONTEND=noninteractive \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl --fail --location -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
         https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
         > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --proxy=http://172.24.231.73:8080 --upgrade pip

COPY requirements.txt .
RUN pip install --no-cache-dir --proxy=http://172.24.231.73:8080 -r requirements.txt

COPY . .

RUN chmod +x scripts/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
