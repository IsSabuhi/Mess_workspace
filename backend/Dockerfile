FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir --proxy=http://@dm1n:@dm1n@172.24.230.4:8080 --upgrade pip

COPY requirements.txt .
RUN pip install --no-cache-dir --proxy=http://@dm1n:@dm1n@172.24.230.4:8080 -r requirements.txt

COPY . .

RUN chmod +x scripts/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
