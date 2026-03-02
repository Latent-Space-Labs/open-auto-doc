import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RepoInfo } from "./repo-picker.js";

export interface ClonedRepo {
  info: RepoInfo;
  localPath: string;
}

export interface CloneOptions {
  shallow?: boolean;
}

export function cloneRepo(
  repo: RepoInfo,
  token: string,
  options: CloneOptions = {},
): ClonedRepo {
  const { shallow = true } = options;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-auto-doc-"));
  const repoDir = path.join(tmpDir, repo.name);

  // Use token in URL for private repo access
  const cloneUrl = repo.cloneUrl.replace(
    "https://",
    `https://x-access-token:${token}@`,
  );

  const depthFlag = shallow ? "--depth 1 " : "";
  execSync(`git clone ${depthFlag}--single-branch "${cloneUrl}" "${repoDir}"`, {
    stdio: "pipe",
  });

  return { info: repo, localPath: repoDir };
}

export function cleanupClone(clonedRepo: ClonedRepo) {
  try {
    fs.rmSync(path.dirname(clonedRepo.localPath), { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}
