import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releasePackages = [
  "packages/shared",
  "packages/stellar-smart-account-auth",
  "packages/x402-payer",
  "packages/sdk",
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
}

function containsWorkspaceProtocol(value) {
  if (typeof value === "string") return value.startsWith("workspace:");
  if (Array.isArray(value)) return value.some(containsWorkspaceProtocol);
  if (value && typeof value === "object") return Object.values(value).some(containsWorkspaceProtocol);
  return false;
}

function tarballName(manifest) {
  return `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
}

function publishedManifest(tarball) {
  return JSON.parse(run("tar", ["-xOf", tarball, "package/package.json"], { capture: true }));
}

function validateTarball(tarball) {
  const manifest = publishedManifest(tarball);
  const contents = run("tar", ["-tzf", tarball], { capture: true }).trim().split("\n");
  if (manifest.private === true) throw new Error(`${manifest.name} is still private`);
  if (containsWorkspaceProtocol(manifest)) throw new Error(`${manifest.name} contains workspace: dependencies`);
  if (manifest.exports?.["."]?.import !== "./dist/index.js") {
    throw new Error(`${manifest.name} does not export dist/index.js`);
  }
  if (manifest.exports?.["."]?.types !== "./dist/index.d.ts") {
    throw new Error(`${manifest.name} does not export dist/index.d.ts`);
  }
  if (!contents.includes("package/dist/index.js") || !contents.includes("package/dist/index.d.ts")) {
    throw new Error(`${manifest.name} tarball is missing runtime or declaration entrypoints`);
  }
  if (contents.some((entry) => entry.startsWith("package/src/"))) {
    throw new Error(`${manifest.name} tarball contains TypeScript source`);
  }
  return manifest;
}

function packRelease(outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const tarballs = [];
  for (const packageDirectory of releasePackages) {
    const absolutePackage = path.join(workspaceRoot, packageDirectory);
    const manifest = JSON.parse(readFileSync(path.join(absolutePackage, "package.json"), "utf8"));
    run("pnpm", ["pack", "--pack-destination", outputDirectory], { cwd: absolutePackage });
    const tarball = path.join(outputDirectory, tarballName(manifest));
    const packedManifest = validateTarball(tarball);
    tarballs.push({ path: tarball, manifest: packedManifest });
  }
  return tarballs;
}

function smokeRelease() {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "agentallowance-sdk-"));
  try {
    const tarballs = packRelease(path.join(temporaryRoot, "tarballs"));
    const dependencies = Object.fromEntries(tarballs.map(({ path: tarball, manifest }) => [
      manifest.name,
      `file:${tarball}`,
    ]));
    writeFileSync(path.join(temporaryRoot, "package.json"), `${JSON.stringify({
      name: "agentallowance-sdk-consumer-smoke",
      private: true,
      type: "module",
      dependencies: {
        ...dependencies,
        "@stellar/stellar-sdk": "16.2.0",
      },
      devDependencies: {
        "@types/node": "24.10.1",
        "typescript": "5.9.3",
      },
    }, null, 2)}\n`);
    writeFileSync(path.join(temporaryRoot, "smoke.mjs"), `
import { AgentAllowanceError, POLICY_REASONS, decimalToAtomic } from "@agentallowance/sdk";

const error = new AgentAllowanceError("BUDGET_EXCEEDED");
if (error.code !== "BUDGET_EXCEEDED") throw new Error("Typed SDK error failed");
if (!POLICY_REASONS.includes("RECIPIENT_NOT_ALLOWED")) throw new Error("Reason codes missing");
if (decimalToAtomic("1.25").toString() !== "12500000") throw new Error("Amount helper failed");
console.log("SDK runtime import passed");
`.trimStart());
    writeFileSync(path.join(temporaryRoot, "smoke.ts"), `
import {
  decimalToAtomic,
  type AllowanceRecord,
  type PolicyDecision,
} from "@agentallowance/sdk";

const decision: PolicyDecision = { allowed: true, remainingAtomic: decimalToAtomic("1").toString() };
const status: AllowanceRecord["status"] = "ACTIVE";
void decision;
void status;
`.trimStart());
    writeFileSync(path.join(temporaryRoot, "tsconfig.json"), `${JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ["smoke.ts"],
    }, null, 2)}\n`);

    run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: temporaryRoot });
    run(process.execPath, [path.join(temporaryRoot, "smoke.mjs")], { cwd: temporaryRoot });
    run(path.join(temporaryRoot, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], {
      cwd: temporaryRoot,
    });
    console.log(`SDK package smoke passed for ${tarballs.map(({ manifest }) => `${manifest.name}@${manifest.version}`).join(", ")}`);
  } finally {
    if (process.env.KEEP_SDK_SMOKE_TEMP === "1") {
      console.log(`Retained smoke directory: ${temporaryRoot}`);
    } else {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

const mode = process.argv[2] ?? "smoke";
if (mode === "pack") {
  const outputDirectory = path.resolve(workspaceRoot, process.argv[3] ?? "artifacts/npm");
  const tarballs = packRelease(outputDirectory);
  console.log(`Packed ${tarballs.length} public packages in ${outputDirectory}`);
} else if (mode === "smoke") {
  smokeRelease();
} else {
  throw new Error(`Unknown SDK package mode: ${mode}`);
}
