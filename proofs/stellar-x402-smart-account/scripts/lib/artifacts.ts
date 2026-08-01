import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("artifacts");

export type Deployment = {
  createdAt: string;
  runDirectory: string;
  network: string;
  rpcUrl: string;
  token: string;
  feePayer: string;
  delegate: string;
  merchant: string;
  policy: string;
  smartAccount: string;
  ruleId: number;
  fundAmount: string;
  paymentAmount: string;
  spendingLimit: string;
  periodLedgers: number;
};

export async function createRunDirectory(): Promise<string> {
  await mkdir(path.join(root, "runs"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDirectory = path.join(root, "runs", stamp);
  await mkdir(runDirectory, { recursive: true });
  await rm(path.join(root, "latest"), { force: true, recursive: true });
  await symlink(path.relative(root, runDirectory), path.join(root, "latest"), "dir");
  return runDirectory;
}

export async function latestDirectory(): Promise<string> {
  return path.join(root, "latest");
}

export async function writeJson(directory: string, name: string, value: unknown): Promise<void> {
  await writeFile(
    path.join(directory, name),
    `${JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2)}\n`,
  );
}

export async function writeText(directory: string, name: string, value: string): Promise<void> {
  await writeFile(path.join(directory, name), value.endsWith("\n") ? value : `${value}\n`);
}

export async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(await latestDirectory(), name), "utf8")) as T;
}

