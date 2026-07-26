# Two-part image: builds the mobile app's Expo web export (the "try it"
# demo), then serves it alongside the static marketing page via nginx.
#
# Context is the REPO ROOT (not site/), unlike every other Dockerfile
# here (backend/Dockerfile, tools/lab-access/Dockerfile) -- this is the
# only build that needs files from two sibling directories (mobile/ for
# the export, site/ for the marketing page) at once. See k8s/site-*.yaml
# and the root .dockerignore's header comment.
#
# EXPO_PUBLIC_API_URL is baked in at build time (Expo inlines
# EXPO_PUBLIC_* vars into the bundle, same as local dev -- see
# mobile/src/api/config.ts) -- must point at the real public API, e.g.
# https://api.skillstreak.app2.isstech.io.

# ---- build stage: Expo web export ------------------------------------------
FROM node:22-alpine AS mobile-build
WORKDIR /app
RUN corepack enable

COPY mobile/package.json mobile/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY mobile/. .

ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
RUN npx expo export --platform web --output-dir /app/web-export

# ---- runtime stage: nginx serving both hosts -------------------------------
FROM nginx:1.27-alpine
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY site/index.html /usr/share/nginx/marketing/index.html
COPY site/assets/ /usr/share/nginx/marketing/assets/
COPY --from=mobile-build /app/web-export/ /usr/share/nginx/app/

# The marketing page's embedded "join/create a team" widget calls the real
# API directly from the browser (GET /teams/invite, POST /players) -- it
# needs to know the API's origin at load time, but index.html is a plain
# static file with no build step of its own to inject an env var into (unlike
# the Expo export above). Same "PLACEHOLDER + sed at build/deploy time"
# convention k8s/api-deployment.yaml already uses for its image field --
# verify the substitution actually landed rather than silently shipping the
# literal placeholder string.
ARG API_BASE_URL=http://localhost:3000
RUN sed -i "s|__API_BASE_URL__|${API_BASE_URL}|" /usr/share/nginx/marketing/index.html \
    && grep -qF "${API_BASE_URL}" /usr/share/nginx/marketing/index.html

# The marketing page's "Öppna demot" links point at the try-it app export
# above -- same PLACEHOLDER+sed reasoning as API_BASE_URL, since that's a
# different origin from the marketing page itself in every real deployment
# (a real domain there, a local IP/port here) and index.html has no build
# step of its own to inject it. Confirmed live 2026-07-26: a local build
# without this would ship the real production try-it URL even when
# testing entirely locally, sending a local tester off to the real public
# demo instead of the one actually running on their own cluster.
ARG TRY_IT_URL=https://try.skillstreak.app2.isstech.io
RUN sed -i "s|__TRY_IT_URL__|${TRY_IT_URL}|g" /usr/share/nginx/marketing/index.html \
    && grep -qF "${TRY_IT_URL}" /usr/share/nginx/marketing/index.html

EXPOSE 80 8081
