# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app

ENV HUSKY=0

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM nginx:1.27-alpine
RUN apk add --no-cache nodejs
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/node_modules /app/node_modules
COPY server /app/server
COPY docker/start-ledgerflow.sh /usr/local/bin/start-ledgerflow.sh
RUN chmod +x /usr/local/bin/start-ledgerflow.sh
EXPOSE 80
CMD ["start-ledgerflow.sh"]
