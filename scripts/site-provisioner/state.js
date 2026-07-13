import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createState(domain) {
  const now = new Date().toISOString();
  return {
    version: 2,
    domain,
    createdAt: now,
    updatedAt: now,
    accessGrants: {},
  };
}

export async function loadState(statePath, domain) {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (![1, 2].includes(parsed.version) || parsed.domain !== domain) {
      throw new Error(`State file does not match ${domain}`);
    }
    if (parsed.version === 1) parsed.version = 2;
    parsed.accessGrants ??= {};
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return createState(domain);
    throw error;
  }
}

export async function saveState(statePath, state) {
  const directory = path.dirname(statePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const next = { ...state, version: 2, updatedAt: new Date().toISOString() };
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, statePath);
  await chmod(statePath, 0o600);
  Object.assign(state, next);
}
