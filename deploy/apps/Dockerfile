FROM node:22-bookworm-slim

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @agentallowance/console... --filter @agentallowance/x402-demo-api... build

ENV NODE_ENV=production
EXPOSE 10000

CMD ["pnpm", "--filter", "@agentallowance/console", "start"]
