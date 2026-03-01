import { Octokit } from "@octokit/rest";
import * as p from "@clack/prompts";

export interface RepoInfo {
  name: string;
  fullName: string;
  cloneUrl: string;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string;
  language: string | null;
  private: boolean;
}

export async function pickRepos(token: string): Promise<RepoInfo[]> {
  const octokit = new Octokit({ auth: token });

  const spinner = p.spinner();
  spinner.start("Fetching your repositories...");

  const repos: RepoInfo[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.repos.listForAuthenticatedUser({
      sort: "updated",
      per_page: 100,
      page,
    });

    if (data.length === 0) break;

    for (const repo of data) {
      repos.push({
        name: repo.name,
        fullName: repo.full_name,
        cloneUrl: repo.clone_url!,
        htmlUrl: repo.html_url,
        description: repo.description,
        defaultBranch: repo.default_branch,
        language: repo.language,
        private: repo.private,
      });
    }

    if (data.length < 100) break;
    page++;
  }

  spinner.stop(`Found ${repos.length} repositories`);

  const selected = await p.multiselect({
    message: "Select repositories to document",
    options: repos.slice(0, 50).map((r) => ({
      value: r.fullName,
      label: r.name,
      hint: [r.language, r.private ? "private" : "public", r.description?.slice(0, 50)]
        .filter(Boolean)
        .join(" · "),
    })),
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return repos.filter((r) => (selected as string[]).includes(r.fullName));
}
