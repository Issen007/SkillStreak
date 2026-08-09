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

# The release this web build came from, shown on the app's profile screen.
# "dev" locally; CI passes the version tag on a release build and the short
# SHA otherwise, so what a user reads always describes the bundle they are
# actually running.
ARG EXPO_PUBLIC_APP_VERSION=dev
ENV EXPO_PUBLIC_APP_VERSION=${EXPO_PUBLIC_APP_VERSION}

# The marketing site's own public base URL (NOT try-it's -- a different
# origin, see TRY_IT_URL below) -- baked into the app so its "Bjud in en
# kompis" share link/QR (mobile/src/team/components/InviteFriendSheet.tsx)
# points somewhere a friend without the app installed can actually open to
# join, via the marketing page's own onboarding widget and its ?code=
# prefill support (site/index.html). Same EXPO_PUBLIC_* build-time-inline
# mechanism as EXPO_PUBLIC_API_URL above.
ARG EXPO_PUBLIC_JOIN_URL=https://skillstreak.app2.isstech.io
ENV EXPO_PUBLIC_JOIN_URL=${EXPO_PUBLIC_JOIN_URL}

# A live `npx expo start` dev server's exp:// URL, when one exists (added
# 2026-07-27) -- lets InviteFriendSheet's QR open Expo Go directly instead
# of falling back to EXPO_PUBLIC_JOIN_URL above. Empty by default: no
# sensible default exists for a manually-started dev-server process.
ARG EXPO_PUBLIC_EXPO_GO_URL=""
ENV EXPO_PUBLIC_EXPO_GO_URL=${EXPO_PUBLIC_EXPO_GO_URL}
RUN npx expo export --platform web --output-dir /app/web-export

# ---- build stage: QR code for site/download.html ---------------------------
# Generates the QR code as an SVG at build time. Encodes EXPO_GO_URL when
# set (a live `npx expo start` dev server's exp:// URL, added 2026-07-27 so
# this page can open Expo Go directly instead of the web export -- there's
# no sensible default for this, since it's a manually-started dev-server
# process, not a stable deployed service) -- otherwise falls back to the
# same TRY_IT_URL every other "Öppna demot" link on this site points at, so
# the code always matches whichever origin this particular build is
# actually for even when no dev server exists (the normal/CI/real-deploy
# case). Node is available here (this stage already has it); the
# nginx:alpine runtime stage below does not, hence a separate stage.
FROM node:22-alpine AS qr-build
ARG TRY_IT_URL=https://try.skillstreak.app2.isstech.io
ARG EXPO_GO_URL=""
RUN QR_TARGET="${EXPO_GO_URL:-$TRY_IT_URL}" \
    && npx --yes qrcode "${QR_TARGET}" -t svg -e M -w 280 -q 1 -d "#1B1B3A" -o /qr.svg \
    && echo -n "${QR_TARGET}" > /qr-target.txt

# ---- runtime stage: nginx serving both hosts -------------------------------
FROM nginx:1.27-alpine
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY site/index.html /usr/share/nginx/marketing/index.html
COPY site/download.html /usr/share/nginx/marketing/download.html
COPY site/assets/ /usr/share/nginx/marketing/assets/
COPY --from=mobile-build /app/web-export/ /usr/share/nginx/app/
COPY --from=qr-build /qr.svg /tmp/qr.svg
COPY --from=qr-build /qr-target.txt /tmp/qr-target.txt

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

# site/download.html: its visible URL text and step-3/note copy differ
# depending on whether the QR above targets Expo Go or the web export
# (qr-build's own /qr-target.txt records which URL actually got encoded,
# since ARG isn't available in this stage the way it is in qr-build) --
# plus the QR SVG spliced in where download.html has an
# INLINE_QR_SVG_HERE placeholder line. awk, not sed's s///, for the SVG
# splice specifically, since the SVG's own content contains "/" characters
# that would break a sed substitution using "/" as its delimiter.
RUN QR_TARGET="$(cat /tmp/qr-target.txt)" \
    && if [ "${QR_TARGET#exp://}" != "${QR_TARGET}" ]; then \
         STEP3='Appen öppnas i <strong>Expo Go</strong> — installera det från App Store/Google Play först om du inte redan har det.'; \
         NOTE='💡 Det här öppnar appen i Expo Go, ett gratis utvecklarverktyg — inte en riktig App Store/Google Play-installation av SkillStreak självt (det finns inget publikt släpp än).'; \
       else \
         STEP3='Demot öppnas i din mobils webbläsare — ingen installation behövs.'; \
         NOTE='💡 Detta är webbversionen av appen, inte en riktig App Store/Google Play-installation — perfekt för att testa flödet snabbt, men vissa mobilspecifika funktioner (t.ex. kamera för videoinspelning) kan bete sig annorlunda än i en riktig app.'; \
       fi \
    && sed -i "s|__DOWNLOAD_QR_URL__|${QR_TARGET}|g" /usr/share/nginx/marketing/download.html \
    && sed -i "s|__DOWNLOAD_STEP3__|${STEP3}|" /usr/share/nginx/marketing/download.html \
    && sed -i "s|__DOWNLOAD_NOTE__|${NOTE}|" /usr/share/nginx/marketing/download.html \
    && grep -qF "${QR_TARGET}" /usr/share/nginx/marketing/download.html \
    && awk '/INLINE_QR_SVG_HERE/{while((getline line < "/tmp/qr.svg") > 0) print line; next} {print}' \
       /usr/share/nginx/marketing/download.html > /tmp/download.html.new \
    && mv /tmp/download.html.new /usr/share/nginx/marketing/download.html \
    && grep -qF "<svg" /usr/share/nginx/marketing/download.html

# Runs as a non-root user (security hardening, 2026-07-30 — k8s's
# securityContext sets runAsUser/runAsNonRoot; this just makes the image
# itself work under that, not only when run as root during a manual
# `docker run`). nginx:1.27-alpine's default paths (pid file, cache dir)
# are root-owned by default — redirect the pid file somewhere always
# writable and chown the cache dir to the image's existing `nginx` user
# (uid 101) rather than inventing a new one.
RUN sed -i 's#^pid .*#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
    && chown -R nginx:nginx /var/cache/nginx

EXPOSE 8080 8081
