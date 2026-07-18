ARG BASE_IMAGE=ghcr.io/getandon/andon-base:main
FROM ${BASE_IMAGE} AS build
WORKDIR /app
COPY . .
RUN npx nest build worker

FROM ${BASE_IMAGE}
RUN apt-get update && \
    apt-get install -y --no-install-recommends wget ca-certificates libssl3 libgssapi-krb5-2 libsasl2-2 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=mongo:7 /usr/bin/mongodump /usr/bin/mongodump
COPY --from=mongo:7 /usr/bin/mongorestore /usr/bin/mongorestore
WORKDIR /app
COPY --from=build /app/dist/apps/worker ./dist
CMD ["node", "dist/apps/worker/src/main.js"]
