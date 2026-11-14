FROM node:24-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache bash gcompat

FROM base AS deps
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc .pnpmfile.cjs ./
COPY scripts/prepare-tools.mjs scripts/prepare-tools.sh scripts/patch-pg-ssl.js ./scripts/
RUN sed -i 's/\r$//' scripts/prepare-tools.sh && pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN node scripts/verify-deploy-package.mjs --source \
    && pnpm build \
    && node scripts/verify-deploy-package.mjs --built \
    && rm -rf .next/cache

FROM base AS runner
ENV NODE_ENV=production
ENV COZE_PROJECT_ENV=PROD
ENV PORT=5000
ENV WUJIE_DATA_DIR=/data
ENV WUJIE_DATA_DIR_DURABLE=true
ENV PATH="/opt/wujie-svg/bin:$PATH"
RUN apk add --no-cache ffmpeg imagemagick potrace py3-cairosvg py3-fonttools py3-numpy py3-parsing py3-typing-extensions \
    && apk add --no-cache --virtual .svg-build-tools py3-virtualenv \
    && virtualenv --system-site-packages /opt/wujie-svg \
    && printf '%s\n' 'ezdxf==1.4.5 --hash=sha256:70a79ec7d40990f60453e3c87ffe9f668907ee061cf6f4c0a3794d032ec2b40e' \
       | python3 -m pip install --no-cache-dir --no-deps --only-binary=:all: --require-hashes -r /dev/stdin \
    && apk del .svg-build-tools \
    && python3 -c 'import cairosvg, ezdxf'
COPY --from=builder /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts/docker-start.sh /app/scripts/presence-server.ts /app/scripts/run-migrations.mjs /app/scripts/upscale_onnx.py ./scripts/
RUN sed -i 's/\r$//' scripts/docker-start.sh
VOLUME ["/data"]
EXPOSE 5000
CMD ["sh", "scripts/docker-start.sh"]
