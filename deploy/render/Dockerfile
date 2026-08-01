FROM node:22-alpine AS plugin-builder

RUN corepack enable && npm install --global esbuild@0.25.12
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/stellar-smart-account-auth/package.json packages/stellar-smart-account-auth/package.json
COPY packages/facilitator-policy/package.json packages/facilitator-policy/package.json
COPY packages/relayer-plugin-x402-facilitator/package.json packages/relayer-plugin-x402-facilitator/package.json
RUN pnpm install --frozen-lockfile \
    --filter @agentallowance/relayer-plugin-x402-facilitator...

COPY packages/stellar-smart-account-auth packages/stellar-smart-account-auth
COPY packages/facilitator-policy packages/facilitator-policy
COPY packages/relayer-plugin-x402-facilitator packages/relayer-plugin-x402-facilitator
RUN esbuild packages/relayer-plugin-x402-facilitator/src/index.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --external:@openzeppelin/relayer-sdk \
    --outfile=/out/index.ts

FROM openzeppelin/openzeppelin-relayer:1.7.0

USER root
# Relayer 1.7.0 hard-codes a 30-second plugin-to-relayer socket timeout.
# Render Free can starve the socket handler while ts-node starts. Keep this
# exact-match patch pinned to the image version so an upstream change fails
# the build instead of silently changing runtime behavior.
RUN sed -i \
    's/export const SOCKET_REQUEST_TIMEOUT_MS = 30000;/export const SOCKET_REQUEST_TIMEOUT_MS = 90000;/' \
    /app/plugins/lib/constants.ts \
    && grep -q 'SOCKET_REQUEST_TIMEOUT_MS = 90000' /app/plugins/lib/constants.ts
RUN mkdir -p /app/config/networks /app/plugins/x402-facilitator \
    && chown -R nonroot:nonroot /app/config /app/plugins/x402-facilitator
COPY --chown=nonroot:nonroot deploy/render/config/config.json /app/config/config.json
COPY --chown=nonroot:nonroot deploy/render/config/networks/stellar.json /app/config/networks/stellar.json
COPY --from=plugin-builder --chown=nonroot:nonroot /out/index.ts /app/plugins/x402-facilitator/index.ts

USER nonroot
WORKDIR /app
EXPOSE 10000
