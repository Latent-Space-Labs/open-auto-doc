import * as p from "@clack/prompts";
import { clearAll } from "../auth/token-store.js";

export async function logoutCommand() {
  p.intro("open-auto-doc — Logout");

  clearAll();

  p.outro("Credentials cleared. You've been logged out.");
}
