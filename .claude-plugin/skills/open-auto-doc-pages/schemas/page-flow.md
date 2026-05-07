# PageFlow JSON contract

The page-crawler subagent returns this shape inside a single fenced ```json block. The `open-auto-doc-pages` orchestrator parses it and merges it into the `AnalysisResult.pageFlow` field of the cache JSON before re-running `generate-from-json`.

## Schema

```jsonc
{
  "pages": [
    {
      "slug": "string (kebab-case URL pathname; '/' → 'home')",
      "url": "string (full or path-relative URL)",
      "title": "string (document.title at crawl time)",
      "screenshot": "string (relative path under <outputDir>/public, e.g. 'page-flow/home.png')",
      "hadModal": "boolean (true if a [role=dialog] was detected and Esc-dismissed)",
      "clickTargets": [
        { "label": "string (anchor text or aria-label, ≤80 chars)", "to": "string (destination slug)" }
      ]
    }
  ],
  "edges": [
    { "from": "string (slug)", "to": "string (slug)", "label": "string (anchor text or button label)" }
  ],
  "mermaid": "string (mermaid graph syntax — 'graph LR\\n  ...' — without ``` fences)",
  "stats": {
    "pagesVisited": "number",
    "pagesSkipped": "number (URLs filtered by exclude/destructive rules)",
    "destructiveBlocked": "number (clicks blocked by destructivePatterns)",
    "errors": ["string (per-page error messages, if any)"]
  },
  "warnings": ["string (non-fatal issues to surface to the user)"]
}
```

## Slug rules

- `/` → `home`
- Path segments lowercased; non-alphanumerics collapsed to `-`; leading/trailing `-` trimmed.
- Collisions get `-2`, `-3`, … suffixes deterministic by visit order.
- Slugs are stable identifiers for the lifetime of one crawl; do not assume cross-run stability.

## File expectations

By the time the subagent returns, screenshots referenced in `pages[*].screenshot` must already exist on disk at `<outputDir>/public/<screenshot>`. The orchestrator does not re-fetch or move them.
