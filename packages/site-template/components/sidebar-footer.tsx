"use client";

import { useState, useEffect } from "react";

const CLI_VERSION = "{{cliVersion}}";
const NPM_PACKAGE = "@latent-space-labs/open-auto-doc";

interface VersionInfo {
  latest: string | null;
  updateAvailable: boolean;
}

export function SidebarFooter() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({
    latest: null,
    updateAvailable: false,
  });
  const [regenerating, setRegenerating] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`)
      .then((res) => res.json())
      .then((data: any) => {
        const latest = data?.version;
        if (latest && latest !== CLI_VERSION) {
          setVersionInfo({ latest, updateAvailable: true });
        }
      })
      .catch(() => {
        // Silently ignore — version check is best-effort
      });
  }, []);

  async function handleRegenerate() {
    setRegenerating(true);
    setStatus("idle");

    try {
      const res = await fetch("/api/regenerate", { method: "POST" });
      if (res.ok) {
        setStatus("success");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-fd-muted-foreground">
          v{CLI_VERSION}
        </span>
        {versionInfo.updateAvailable && versionInfo.latest && (
          <span className="rounded bg-fd-primary/10 px-1.5 py-0.5 text-fd-primary text-[10px] font-medium">
            v{versionInfo.latest} available
          </span>
        )}
      </div>
      <button
        onClick={handleRegenerate}
        disabled={regenerating}
        className="inline-flex items-center justify-center rounded-md border border-fd-border bg-fd-background px-3 py-1.5 text-xs font-medium text-fd-foreground transition-colors hover:bg-fd-accent disabled:pointer-events-none disabled:opacity-50"
      >
        {regenerating ? (
          <>
            <svg
              className="mr-1.5 h-3 w-3 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Regenerating…
          </>
        ) : (
          <>
            <svg
              className="mr-1.5 h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            Regenerate Docs
          </>
        )}
      </button>
      {status === "success" && (
        <p className="text-fd-muted-foreground text-[10px]">
          Workflow dispatched. Docs will update shortly.
        </p>
      )}
      {status === "error" && (
        <p className="text-red-500 text-[10px]">
          Failed to trigger regeneration. Check environment variables.
        </p>
      )}
    </div>
  );
}
