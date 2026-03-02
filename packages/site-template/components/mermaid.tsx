"use client";

import { useEffect, useId, useRef, useState } from "react";

export function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/:/g, "m");
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "loose",
        });
        const { svg: rendered } = await mermaid.render(
          `mermaid-${id}`,
          code,
        );
        if (!cancelled) setSvg(rendered);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Diagram error");
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    return (
      <pre className="rounded-lg border bg-fd-card p-4 text-sm text-fd-muted-foreground overflow-x-auto">
        <code>{code}</code>
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center rounded-lg border bg-fd-card p-8 text-sm text-fd-muted-foreground">
        Loading diagram...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center overflow-x-auto rounded-lg border bg-fd-card p-4 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
