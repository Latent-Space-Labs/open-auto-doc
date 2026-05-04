# AnalysisResult Schema

This is the canonical JSON shape that subagents return. The main skill assembles
the per-section outputs into a single `AnalysisResult` object and writes it to
`<outputDir>/.autodoc-cache/<repo-slug>-analysis.json` for the generator package
to consume.

The authoritative TypeScript types live at `packages/analyzer/src/types.ts` —
keep this file in sync if those change.

## Top-level shape

```jsonc
{
  "repoName": "string — slugified directory or repo name",
  "repoUrl": "string — GitHub URL if available, else empty string",
  "staticAnalysis": {
    "fileTree": { "path": ".", "name": "repo", "type": "directory", "children": [] },
    "languages": ["typescript", "..."],
    "dependencies": [],
    "claudeMd": [{ "path": "CLAUDE.md", "content": "..." }],
    "entryFiles": ["src/index.ts"],
    "totalFiles": 0
  },
  "architecture":   /* ArchitectureOverview, see architect.md */,
  "features":       /* FeaturesAnalysis | null, see features.md */,
  "apiEndpoints":   /* ApiEndpoint[],         see api-doc.md */,
  "components":     /* ComponentDoc[],        see component-doc.md */,
  "dataModels":     /* DataModelDoc[],        see model-doc.md */,
  "gettingStarted": /* GettingStartedGuide,   see guide-writer.md */,
  "diagrams":       [/* MermaidDiagram[] — pulled from architecture.diagrams */],
  "configuration":  /* ConfigurationAnalysis | null, see config-doc.md */,
  "businessLogic":  /* BusinessLogicAnalysis | null, see business-logic.md */,
  "errorHandling":  /* ErrorHandlingAnalysis | null, see error-doc.md */
}
```

## ArchitectureOverview (Wave 1, required)

```jsonc
{
  "summary": "2-3 paragraph description of the project",
  "projectPurpose": "1-2 paragraph plain-language description for someone new",
  "targetAudience": "Who would use this software and why",
  "techStack": ["TypeScript", "Next.js", "..."],
  "modules": [
    {
      "name": "string",
      "description": "string",
      "files": ["string"],
      "responsibilities": ["string"]
    }
  ],
  "dataFlow": "string — how data flows through the system",
  "entryPoints": ["string — file paths"],
  "keyPatterns": ["string — architectural patterns"],
  "diagrams": [
    {
      "id": "string — kebab-case",
      "title": "string",
      "description": "string",
      "mermaidSyntax": "string — valid Mermaid"
    }
  ]
}
```

## ApiEndpoint[] (Wave 2)

```jsonc
[
  {
    "method": "GET | POST | PUT | DELETE | PATCH",
    "path": "/api/...",
    "description": "string",
    "parameters": [
      {
        "name": "string",
        "type": "string",
        "required": true,
        "description": "string",
        "location": "path | query | header | body"
      }
    ],
    "requestBody": "string — optional",
    "responseBody": "string — optional",
    "authentication": "string — optional"
  }
]
```

## ComponentDoc[] (Wave 2)

```jsonc
[
  {
    "name": "string",
    "description": "string",
    "filePath": "string",
    "props": [
      {
        "name": "string",
        "type": "string",
        "required": true,
        "defaultValue": "string — optional",
        "description": "string"
      }
    ],
    "usage": "string — example code",
    "category": "string — optional grouping"
  }
]
```

## DataModelDoc[] (Wave 2)

```jsonc
[
  {
    "name": "string",
    "description": "string",
    "filePath": "string",
    "fields": [
      {
        "name": "string",
        "type": "string",
        "description": "string",
        "constraints": ["string — optional"]
      }
    ],
    "relationships": ["string"]
  }
]
```

## FeaturesAnalysis (Wave 2)

```jsonc
{
  "tagline": "string",
  "targetAudience": "string",
  "features": [
    {
      "name": "string",
      "description": "string",
      "category": "string",
      "relatedFiles": ["string"]
    }
  ],
  "useCases": [
    {
      "title": "string",
      "description": "string",
      "involvedFeatures": ["string"]
    }
  ]
}
```

## ConfigurationAnalysis (Wave 2)

```jsonc
{
  "configItems": [
    {
      "name": "string",
      "source": "string — file path or env",
      "type": "string",
      "defaultValue": "string — optional",
      "required": true,
      "description": "string",
      "category": "string — optional"
    }
  ],
  "configFiles": ["string"],
  "environmentVariables": ["string"]
}
```

## BusinessLogicAnalysis (Wave 2)

```jsonc
{
  "domainConcepts": [
    { "name": "string", "description": "string", "relatedFiles": ["string"] }
  ],
  "businessRules": [
    { "name": "string", "description": "string", "sourceFiles": ["string"], "category": "string — optional" }
  ],
  "workflows": [
    {
      "name": "string",
      "description": "string",
      "steps": ["string"],
      "diagram": { "id": "string", "title": "string", "description": "string", "mermaidSyntax": "string" }  // optional — omit if no meaningful diagram applies
    }
  ],
  "keyInvariants": ["string"]
}
```

## ErrorHandlingAnalysis (Wave 2)

```jsonc
{
  "errorCodes": [
    {
      "code": "string",
      "httpStatus": 404,
      "message": "string",
      "description": "string",
      "sourceFile": "string — optional"
    }
  ],
  "commonErrors": [
    { "error": "string", "cause": "string", "solution": "string", "category": "string — optional" }
  ],
  "errorClasses": ["string"],
  "debuggingTips": ["string"]
}
```

## GettingStartedGuide (Wave 3)

```jsonc
{
  "prerequisites": ["string"],
  "installation": "string — markdown",
  "quickStart": "string — markdown",
  "configuration": "string — optional markdown",
  "examples": "string — optional markdown"
}
```

## Subagent output convention

Every subagent MUST return its result as a single fenced JSON code block, with
no prose before or after:

````markdown
```json
{ ... }
```
````

The main skill parses the first JSON block from each subagent's output. If a
subagent fails to produce valid JSON, the main skill marks that section as
`null` (for nullable fields) or `[]` (for array fields) and continues.
