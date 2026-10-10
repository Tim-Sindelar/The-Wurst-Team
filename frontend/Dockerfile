FROM node:22.23.2-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG APP_BASE_PATH=/
ARG SOCIAL_ENABLED=true
ARG SOCIAL_DEMO_ENABLED=false
ENV VITE_API_BASE_URL="" VITE_APP_BASE_PATH=${APP_BASE_PATH} VITE_SOCIAL_ENABLED=${SOCIAL_ENABLED} VITE_SOCIAL_DEMO_ENABLED=${SOCIAL_DEMO_ENABLED}
RUN npm run build

FROM caddy:2.11.2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080
