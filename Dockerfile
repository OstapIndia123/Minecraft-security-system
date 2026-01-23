ARG BASE_IMAGE=node:20-alpine
FROM ${BASE_IMAGE}

WORKDIR /app

ARG NPM_REGISTRY=
ARG SKIP_NPM_INSTALL=false

COPY backend backend
COPY hub-backend hub-backend
COPY web web
COPY docker/start.sh /app/start.sh

RUN if [ "$SKIP_NPM_INSTALL" != "true" ]; then \
    if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi; \
    if [ ! -d backend/node_modules ]; then npm --prefix backend install --omit=dev; fi; \
    if [ ! -d hub-backend/node_modules ]; then npm --prefix hub-backend install --omit=dev; fi; \
  fi

RUN chmod +x /app/start.sh && mkdir -p /data

EXPOSE 8080 8090 5080

CMD ["/app/start.sh"]
