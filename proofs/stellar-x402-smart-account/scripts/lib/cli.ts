import { execFileSync } from "node:child_process";

export function stellar(args: string[], options: { quiet?: boolean } = {}): string {
  return execFileSync("stellar", options.quiet ? ["--quiet", ...args] : args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function identityExists(name: string): boolean {
  try {
    stellar(["keys", "address", name], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

