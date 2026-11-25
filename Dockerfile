# syntax=docker/dockerfile:1.7
# 构建阶段与运行时、CI 统一用 Node 24。
# 这里原本是 node:20 —— 而运行时是 24、CI 也是 24,于是"生产构建"只在 20 上被验证过,
# 换句话说 vite build 在 24 上能不能过没人知道(不过的话只有部署时才发现)。
# 现在 CI 的 verify 里有 npm run build(先在 24 上跑通、再加这一行),两边一致了。
FROM node:24-alpine AS build
WORKDIR /app

ENV HUSKY=0

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM node:24-alpine
RUN apk add --no-cache nginx
WORKDIR /app
ENV LEDGERFLOW_API_PORT=8787
ENV LEDGERFLOW_DATA_DIR=/app/data
ENV SQLITE_PATH=/app/data/ledgerflow.sqlite
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/node_modules /app/node_modules
COPY server /app/server
COPY docker/start-ledgerflow.sh /usr/local/bin/start-ledgerflow.sh
# 规范化行尾,作为 .gitattributes 之外的第二道防线:即使构建上下文来自 CRLF 的
# 检出(Windows + core.autocrlf),镜像里的入口脚本也必须能被 exec,nginx 配置也
# 必须能被 awk 正常匹配(否则 PORT 改写会静默失效,容器只在 80 上监听)。
RUN mkdir -p /app/data \
 && tr -d '\r' < /usr/local/bin/start-ledgerflow.sh > /tmp/start.sh \
 && mv /tmp/start.sh /usr/local/bin/start-ledgerflow.sh \
 && tr -d '\r' < /etc/nginx/http.d/default.conf > /tmp/nginx.conf \
 && mv /tmp/nginx.conf /etc/nginx/http.d/default.conf \
 && chmod +x /usr/local/bin/start-ledgerflow.sh
EXPOSE 80
CMD ["/usr/local/bin/start-ledgerflow.sh"]
