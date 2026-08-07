# benchy — eval suite for LLM apps (CLI + results dashboard)
# Build:  docker build -t benchy .
# Run:    docker run --rm -v $(pwd)/.benchy:/benchy/.benchy benchy --help

# ---- build stage -----------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsup.config.ts ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# ---- runtime stage ----------------------------------------------------------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /benchy

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=build /src/dist ./dist
COPY examples ./examples
COPY benchy-baseline.json ./benchy-baseline.json

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 4173
ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["serve"]