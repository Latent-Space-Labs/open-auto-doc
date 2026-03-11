import { NextResponse } from "next/server";

export async function POST() {
  const githubToken = process.env.GITHUB_TOKEN;
  const docsRepo = process.env.DOCS_REPO; // e.g. "owner/repo-name"

  if (!githubToken || !docsRepo) {
    return NextResponse.json(
      { error: "Missing GITHUB_TOKEN or DOCS_REPO environment variable" },
      { status: 500 },
    );
  }

  try {
    // Find the regenerate workflow by name
    const workflowsRes = await fetch(
      `https://api.github.com/repos/${docsRepo}/actions/workflows`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!workflowsRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch workflows" },
        { status: workflowsRes.status },
      );
    }

    const workflowsData = (await workflowsRes.json()) as {
      workflows: Array<{ id: number; name: string; path: string }>;
    };

    const workflow = workflowsData.workflows.find(
      (w) =>
        w.path === ".github/workflows/regenerate.yml" ||
        w.name === "Regenerate Documentation",
    );

    if (!workflow) {
      return NextResponse.json(
        { error: "Regeneration workflow not found in repository" },
        { status: 404 },
      );
    }

    // Dispatch the workflow
    const dispatchRes = await fetch(
      `https://api.github.com/repos/${docsRepo}/actions/workflows/${workflow.id}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main" }),
      },
    );

    if (!dispatchRes.ok) {
      const errorText = await dispatchRes.text();
      return NextResponse.json(
        { error: `Failed to dispatch workflow: ${errorText}` },
        { status: dispatchRes.status },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
