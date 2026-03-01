import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".open-auto-doc");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");

interface StoredCredentials {
  githubToken?: string;
  anthropicKey?: string;
}

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function readCredentials(): StoredCredentials {
  if (!fs.existsSync(CREDENTIALS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeCredentials(creds: StoredCredentials) {
  ensureConfigDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

export function getGithubToken(): string | undefined {
  return readCredentials().githubToken;
}

export function setGithubToken(token: string) {
  const creds = readCredentials();
  creds.githubToken = token;
  writeCredentials(creds);
}

export function clearGithubToken() {
  const creds = readCredentials();
  delete creds.githubToken;
  writeCredentials(creds);
}

export function getAnthropicKey(): string | undefined {
  return readCredentials().anthropicKey;
}

export function setAnthropicKey(key: string) {
  const creds = readCredentials();
  creds.anthropicKey = key;
  writeCredentials(creds);
}

export function clearAll() {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    fs.unlinkSync(CREDENTIALS_FILE);
  }
}
