# syntax=docker/dockerfile:1.7

FROM node:22-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# === Python + veridrop venv ===
# 单独阶段, 失败不影响主程序构建。装到 /opt/veridrop/venv 全自包含,
# 后面只往 runner 拷这一坨。pyproject 标的依赖是 httpx / pydantic /
# typer / rich / rapidfuzz, 装完 ~80MB。
FROM debian:bookworm-slim AS pybuild
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/veridrop
COPY vendor/veridrop /opt/veridrop/src-veridrop
RUN python3 -m venv /opt/veridrop/venv \
 && /opt/veridrop/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/veridrop/venv/bin/pip install --no-cache-dir /opt/veridrop/src-veridrop

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL=file:/app/data/app.db

# Python runtime + veridrop venv (从 pybuild 拷过来; 不带编译工具链)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=pybuild /opt/veridrop /opt/veridrop
# 让 spawn relay-detector 的时候能在 PATH 里直接找到
ENV PATH=/opt/veridrop/venv/bin:$PATH
ENV VERIDROP_BIN=/opt/veridrop/venv/bin/relay-detector
ENV VERIDROP_CWD=/opt/veridrop/src-veridrop

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/scripts ./scripts
RUN mkdir -p /app/data

EXPOSE 3100
# 启动前跑增量 migration(幂等),让新列自动落到现网 DB。失败不阻塞 server。
CMD ["sh", "-c", "node scripts/migrate.mjs || true; exec node server.js"]
