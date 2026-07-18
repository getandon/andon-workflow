ARG BASE_IMAGE=ghcr.io/getandon/andon-base:main
FROM ${BASE_IMAGE} AS build
WORKDIR /app
COPY . .
RUN npx prisma generate && npx nest build api

FROM ${BASE_IMAGE}
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=build /app/dist/apps/api ./dist
COPY --from=build /app/prisma ./prisma

RUN npx prisma generate && \
    mkdir -p /app/data

EXPOSE 3000
CMD npx prisma db push && node dist/apps/api/src/main.js
