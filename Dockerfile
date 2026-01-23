ARG BASE_IMAGE=node:20-alpine
FROM ${BASE_IMAGE}

WORKDIR /app

COPY backend/package.json backend/
RUN npm --prefix backend install --omit=dev

COPY hub-backend/package.json hub-backend/
RUN npm --prefix hub-backend install --omit=dev

COPY backend backend
COPY hub-backend hub-backend
COPY web web
COPY docker/start.sh /app/start.sh

RUN chmod +x /app/start.sh && mkdir -p /data

EXPOSE 8080 8090 5080

CMD ["/app/start.sh"]
