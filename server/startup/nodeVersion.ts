// Keep in sync with "engines.node" in package.json (a test checks this).
export const MIN_NODE_VERSION = "22.12.0";

function parse(version: string): number[] {
  return version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
}

/**
 * Returns a readable error when the running Node is older than the project
 * supports, or null when it is fine. On older versions better-sqlite3's native
 * module can crash the process (SIGSEGV) instead of failing with a message.
 */
export function nodeVersionError(current: string = process.versions.node, minimum: string = MIN_NODE_VERSION): string | null {
  const have = parse(current);
  const need = parse(minimum);
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a > b) return null;
    if (a < b) {
      return `TracePilot needs Node.js ${minimum} or newer, but this is ${current}. Run "nvm use" (the repo's .nvmrc pins 24) and reinstall dependencies with "npm ci" if native modules were built for another version.`;
    }
  }
  return null;
}
