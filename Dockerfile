# Drawer: the SvelteKit app, its enrichment worker and the local tools it reads files with (poppler, tesseract with
# English, Spanish and Catalan, ffmpeg). State lives in /data (SQLite and the files). The `import` stage keeps the
# source and dev dependencies for the one-off WhatsApp import (README.md).
FROM node:24-slim AS tools
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg poppler-utils \
     tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa tesseract-ocr-cat \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir /data && chown node:node /data

FROM base AS import
WORKDIR /app
COPY --from=tools /app /app
ENV DRAWER_DATA=/data
USER node
ENTRYPOINT ["node", "node_modules/tsx/dist/cli.mjs", "scripts/import.ts"]

FROM base
WORKDIR /app
COPY --from=tools /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=tools /app/build build
# BODY_SIZE_LIMIT: phone videos and scanned PDFs come in whole.
ENV NODE_ENV=production PORT=3000 DRAWER_DATA=/data BODY_SIZE_LIMIT=512M
USER node
EXPOSE 3000
CMD ["node", "build"]
