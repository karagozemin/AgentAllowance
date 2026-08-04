# Publishing the SDK

The public SDK release consists of four MIT packages at the same version. Applications install only
`@agentallowance/sdk`; the other packages are normal transitive dependencies.

```text
@agentallowance/sdk
  -> @agentallowance/shared
  -> @agentallowance/stellar-smart-account-auth
  -> @agentallowance/x402-payer
```

## Release gates

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:sdk-package
pnpm pack:sdk
```

`test:sdk-package` packs all four packages, validates the published manifests, installs the tarballs
in a clean temporary npm project, executes a runtime import, and compiles a TypeScript consumer.

## Authenticate

The publisher must belong to the `@agentallowance` npm organization and have publish permission.

```bash
npm login
npm whoami
```

Use an npm automation token in CI. Never commit `.npmrc` or print the token.

## Publish order

Publish the dependency graph before the SDK:

```bash
pnpm --filter @agentallowance/shared publish --access public --no-git-checks
pnpm --filter @agentallowance/stellar-smart-account-auth publish --access public --no-git-checks
pnpm --filter @agentallowance/x402-payer publish --access public --no-git-checks
pnpm --filter @agentallowance/sdk publish --access public --no-git-checks
```

Verify from a directory outside the monorepo:

```bash
npm view @agentallowance/sdk version
npm install @agentallowance/sdk @stellar/stellar-sdk
```

All four versions must remain aligned. Never overwrite a published version; bump the patch version,
rerun the gates, and create a matching repository release tag.
