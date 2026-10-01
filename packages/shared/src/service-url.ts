const EXPLICIT_SCHEME = /^https?:\/\//u;
const LOCAL_ADDRESS = /^(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?$/u;
const EXPLICIT_PORT = /:\d+$/u;

export function serviceOrigin(value: string, internalPort = 10_000): string {
  const host = value.trim().replace(/\/+$/u, "");
  if (!host) throw new Error("Service host must not be empty");
  if (EXPLICIT_SCHEME.test(host)) return host;

  const isPrivateHost = LOCAL_ADDRESS.test(host) || !host.includes(".");
  if (!isPrivateHost) return `https://${host}`;
  return `http://${host}${EXPLICIT_PORT.test(host) ? "" : `:${internalPort}`}`;
}
