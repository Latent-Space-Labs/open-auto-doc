import * as p from "@clack/prompts";
import { getVercelToken, setVercelToken } from "../auth/token-store.js";
import type { AutodocConfig } from "../config.js";
import { saveConfig } from "../config.js";

const VERCEL_API = "https://api.vercel.com";

interface VercelFetchOptions {
  method?: string;
  body?: unknown;
  teamId?: string;
}

async function vercelFetch<T = unknown>(
  path: string,
  token: string,
  options: VercelFetchOptions = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const { method = "GET", body, teamId } = options;

  const url = new URL(path, VERCEL_API);
  if (teamId) {
    url.searchParams.set("teamId", teamId);
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Authenticates with Vercel — checks env/saved token, prompts if missing.
 * Returns the token or null if the user cancels.
 */
export async function authenticateVercel(): Promise<string | null> {
  const existing = getVercelToken();
  if (existing) {
    // Validate the saved token
    const { ok } = await vercelFetch<{ user: { username: string } }>(
      "/v2/user",
      existing,
    );
    if (ok) {
      p.log.success("Using saved Vercel token.");
      return existing;
    }
    p.log.warn("Saved Vercel token is invalid.");
  }

  p.note(
    [
      "To create a Vercel access token:",
      "",
      "  1. Go to https://vercel.com/account/settings/tokens",
      "  2. Click 'Create Token'",
      "  3. Enter a name (e.g., 'open-auto-doc')",
      "  4. Select the scope (your personal account or a team)",
      "  5. Set an expiration (or no expiration for convenience)",
      "  6. Click 'Create Token' and copy the value",
    ].join("\n"),
    "Vercel Token Required",
  );

  const tokenInput = await p.text({
    message: "Enter your Vercel token",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxx",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Token is required";
    },
  });

  if (p.isCancel(tokenInput)) return null;
  const token = (tokenInput as string).trim();

  // Validate
  const { ok, data } = await vercelFetch<{ user: { username: string } }>(
    "/v2/user",
    token,
  );
  if (!ok) {
    p.log.error("Invalid Vercel token. Please check and try again.");
    return null;
  }

  p.log.success(`Authenticated as ${(data as any).user?.username ?? "Vercel user"}`);

  const save = await p.confirm({
    message: "Save Vercel token for future use?",
  });
  if (!p.isCancel(save) && save) {
    setVercelToken(token);
  }

  return token;
}

interface DeployParams {
  token: string;
  githubOwner: string;
  githubRepo: string;
  docsDir: string;
  config: AutodocConfig;
  /** If provided, skip the interactive scope prompt and use this team ID (undefined = personal account). */
  scope?: { teamId: string | undefined };
}

interface DeployToVercelResult {
  projectUrl: string;
  deploymentUrl: string;
}

/**
 * Creates a Vercel project linked to a GitHub repo and waits for initial deployment.
 * Returns URLs or null on failure.
 */
export async function deployToVercel(
  params: DeployParams,
): Promise<DeployToVercelResult | null> {
  const { token, githubOwner, githubRepo, docsDir, config } = params;

  // 1. Determine scope (team or personal)
  let teamId: string | undefined;

  if (params.scope) {
    // Use pre-collected scope
    teamId = params.scope.teamId;
  } else {
    // Interactive scope selection
    const { data: userData } = await vercelFetch<{ user: { id: string; username: string } }>(
      "/v2/user",
      token,
    );

    const { data: teamsData } = await vercelFetch<{ teams: Array<{ id: string; name: string; slug: string }> }>(
      "/v2/teams",
      token,
    );
    const teams = (teamsData as any).teams ?? [];

    if (teams.length > 0) {
      const scopeOptions = [
        { value: "__personal__", label: (userData as any).user?.username ?? "Personal", hint: "Personal account" },
        ...teams.map((t: any) => ({ value: t.id, label: t.name || t.slug, hint: "Team" })),
      ];

      const selectedScope = await p.select({
        message: "Which Vercel scope should own this project?",
        options: scopeOptions,
      });

      if (p.isCancel(selectedScope)) return null;
      if (selectedScope !== "__personal__") {
        teamId = selectedScope as string;
      }
    }
  }

  // 2. Create project
  const spinner = p.spinner();
  spinner.start("Creating Vercel project...");

  const repoSlug = `${githubOwner}/${githubRepo}`;
  const createProject = async (): Promise<any> => {
    return vercelFetch(
      "/v10/projects",
      token,
      {
        method: "POST",
        teamId,
        body: {
          name: githubRepo,
          framework: "nextjs",
          gitRepository: {
            type: "github",
            repo: repoSlug,
          },
        },
      },
    );
  };

  let projectRes = await createProject();

  // If GitHub integration isn't installed, prompt user to install it
  if (!projectRes.ok && (projectRes.status === 400 || projectRes.status === 403)) {
    spinner.stop("GitHub integration required.");

    const errorData = projectRes.data as any;
    const errorMsg = errorData?.error?.message || "Vercel cannot access your GitHub repo.";
    p.log.warn(errorMsg);
    p.log.info(
      "Install the Vercel GitHub App: https://github.com/apps/vercel",
    );

    const retry = await p.confirm({
      message: "Have you installed the Vercel GitHub App? Retry?",
    });

    if (p.isCancel(retry) || !retry) return null;

    spinner.start("Retrying project creation...");
    projectRes = await createProject();
  }

  if (!projectRes.ok) {
    spinner.stop("Failed to create Vercel project.");
    const errorData = projectRes.data as any;
    p.log.error(
      `Vercel API error (${projectRes.status}): ${errorData?.error?.message || JSON.stringify(errorData)}`,
    );
    return null;
  }

  const project = projectRes.data as any;
  const projectId = project.id;
  const projectName = project.name;
  spinner.stop(`Created Vercel project: ${projectName}`);

  // 3. Explicitly trigger a deployment (Vercel doesn't always auto-deploy on project creation)
  spinner.start("Triggering first deployment...");
  const { ok: deployOk } = await vercelFetch(
    "/v13/deployments",
    token,
    {
      method: "POST",
      teamId,
      body: {
        name: projectName,
        project: projectId,
        target: "production",
        gitSource: {
          type: "github",
          org: githubOwner,
          repo: githubRepo,
          ref: "main",
        },
      },
    },
  );

  if (!deployOk) {
    // Non-fatal: the auto-deploy may still kick in, so continue to polling
    spinner.message("Waiting for deployment...");
  }

  // 4. Poll for first deployment
  spinner.start("Waiting for first deployment...");

  const maxWaitMs = 5 * 60 * 1000; // 5 minutes
  const pollIntervalMs = 5000;
  const startTime = Date.now();
  let deploymentUrl: string | undefined;

  while (Date.now() - startTime < maxWaitMs) {
    const { ok: deploymentsOk, data: deploymentsData } = await vercelFetch<{
      deployments: Array<{ uid: string; state: string; url: string; ready?: number }>;
    }>(
      `/v6/deployments?projectId=${projectId}&limit=1`,
      token,
      { teamId },
    );

    if (deploymentsOk) {
      const deployments = (deploymentsData as any).deployments ?? [];
      if (deployments.length > 0) {
        const deployment = deployments[0];
        const state = deployment.state?.toUpperCase();

        if (state === "READY") {
          deploymentUrl = `https://${deployment.url}`;
          break;
        } else if (state === "ERROR" || state === "CANCELED") {
          spinner.stop("Deployment failed.");
          p.log.warn(
            `Check the Vercel dashboard: https://vercel.com/${teamId ? `team/${teamId}` : "dashboard"}/${projectName}`,
          );
          return null;
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        spinner.message(`Waiting for deployment... (${state}, ${elapsed}s)`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (!deploymentUrl) {
    spinner.stop("Deployment is still in progress.");
    const dashboardUrl = `https://vercel.com/${teamId ? `team/${teamId}` : "dashboard"}/${projectName}`;
    p.log.warn(
      `Timed out waiting for deployment. Check status at: ${dashboardUrl}`,
    );
    // Still return partial result since the project was created successfully
    const projectUrl = `https://vercel.com/${teamId ? `team/${teamId}` : "dashboard"}/${projectName}`;
    return { projectUrl, deploymentUrl: dashboardUrl };
  }

  spinner.stop(`Deployed successfully!`);

  // 4. Save vercelUrl to config
  const projectUrl = `https://vercel.com/${teamId ? `team/${teamId}` : "dashboard"}/${projectName}`;
  try {
    const updatedConfig: AutodocConfig = { ...config, vercelUrl: deploymentUrl };
    saveConfig(updatedConfig);
  } catch {
    // Non-critical
  }

  return { projectUrl, deploymentUrl };
}
