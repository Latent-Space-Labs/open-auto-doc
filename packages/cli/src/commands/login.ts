import * as p from "@clack/prompts";
import { authenticateWithGithub } from "../auth/device-flow.js";
import { setGithubToken, getGithubToken } from "../auth/token-store.js";

export async function loginCommand() {
  p.intro("open-auto-doc — GitHub Login");

  const existing = getGithubToken();
  if (existing) {
    const overwrite = await p.confirm({
      message: "You're already logged in. Re-authenticate?",
    });
    if (!overwrite || p.isCancel(overwrite)) {
      p.cancel("Keeping existing credentials");
      return;
    }
  }

  const token = await authenticateWithGithub();
  setGithubToken(token);

  p.outro("Logged in successfully!");
}
