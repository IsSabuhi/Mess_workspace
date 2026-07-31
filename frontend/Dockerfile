FROM node:20-alpine AS build

WORKDIR /app

# Прокси настройки
ARG PROXY_HOST=172.24.230.4
ARG PROXY_PORT=8080
ARG PROXY_USER=@dm1n
ARG PROXY_PASS=@dm1n

ENV HTTP_PROXY=http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}
ENV HTTPS_PROXY=http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}
ENV NO_PROXY=localhost,127.0.0.1

COPY package.json package-lock.json ./

RUN npm config set proxy ${HTTP_PROXY} \
    && npm config set https-proxy ${HTTPS_PROXY} \
    && npm config set registry https://registry.npmjs.org/

RUN npm ci

COPY . .
ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
