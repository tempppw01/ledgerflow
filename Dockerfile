# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app

ENV HUSKY=0

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM node:24-alpine
RUN apk add --no-cache nginx
ENV LEDGERFLOW_API_PORT=8787
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/node_modules /app/node_modules
COPY server /app/server
COPY docker/start-ledgerflow.sh /usr/local/bin/start-ledgerflow.sh
RUN mkdir -p /app/data && chmod +x /usr/local/bin/start-ledgerflow.sh
EXPOSE 80
CMD ["start-ledgerflow.sh"]
