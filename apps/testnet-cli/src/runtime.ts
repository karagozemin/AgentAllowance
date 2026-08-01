import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const artifactRoot = path.resolve("artifacts/testnet");

export function stellar(args: string[], quiet = false): string {
  return execFileSync("stellar", quiet ? ["--quiet", ...args] : args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function identityExists(name: string): boolean {
  try {
    stellar(["keys", "address", name], true);
    return true;
  } catch {
    return false;
  }
}

export async function createRunDirectory(): Promise<string> {
  const runDirectory = path.join(
    artifactRoot,
    "runs",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(runDirectory, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(path.join(artifactRoot, "latest.json"), `${JSON.stringify({ runDirectory }, null, 2)}\n`);
  return runDirectory;
}

export async function latestRunDirectory(): Promise<string> {
  const override = process.env.RUN_DIRECTORY;
  if (override) return path.resolve(override);
  const latest = JSON.parse(await readFile(path.join(artifactRoot, "latest.json"), "utf8")) as {
    runDirectory: string;
  };
  return latest.runDirectory;
}

export async function writeJson(directory: string, name: string, value: unknown): Promise<void> {
  await writeFile(
    path.join(directory, name),
    `${JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item), 2)}\n`,
  );
}

export async function writeText(directory: string, name: string, value: string): Promise<void> {
  await writeFile(path.join(directory, name), value.endsWith("\n") ? value : `${value}\n`);
}

export async function readRunJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(await latestRunDirectory(), name), "utf8")) as T;
}
