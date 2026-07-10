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

EXPOSE 80
