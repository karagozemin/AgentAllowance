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
RUN mkdir -p /app/config/networks /app/plugins/x402-facilitator \
    && chown -R nonroot:nonroot /app/config /app/plugins/x402-facilitator
COPY --chown=nonroot:nonroot deploy/render/config/config.json /app/config/config.json
COPY --chown=nonroot:nonroot deploy/render/config/networks/stellar.json /app/config/networks/stellar.json
COPY --from=plugin-builder --chown=nonroot:nonroot /out/index.ts /app/plugins/x402-facilitator/index.ts
COPY --from=plugin-builder --chown=nonroot:nonroot /out/index.ts /app/plugins/x402-facilitator/index.cjs
COPY --chown=nonroot:nonroot deploy/render/adapter.cjs /app/render-adapter.cjs

USER nonroot
WORKDIR /app
EXPOSE 10000
ENTRYPOINT ["node", "/app/render-adapter.cjs"]
