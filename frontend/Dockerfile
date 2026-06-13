# Étape 1 : build Vite (Node) · Étape 2 : runtime nginx statique.

FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# VITE_API_URL=/api/v1 (relatif) : le nginx du conteneur proxifie /api → backend.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=12 \
  CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1
