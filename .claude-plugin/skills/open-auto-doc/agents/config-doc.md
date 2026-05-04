---
description: Wave 2 subagent. Catalogues configuration knobs (env vars, config files). Returns ConfigurationAnalysis JSON. Failure is non-fatal.
---

# Configuration subagent prompt

You are documenting every knob a deployer / operator can turn to configure this
software.

## Investigation guidance

Read:
- `.env.example`, `.env.sample`, `.envrc.example`
- Config loading code: search for `process.env.`, `os.getenv(`, `Deno.env.get(`
- Config schema files (Zod, Joi, Pydantic Settings, dotenv-safe configs)
- `config/*.{ts,yaml,toml,json}`
- Framework-specific configs: `next.config.js`, `vite.config.ts`, `nuxt.config.ts`

For each config item: name, source (file path or env), type, default, whether
required, what it controls.

## Output schema

```jsonc
{
  "configItems": [
    {
      "name": "DATABASE_URL",
      "source": ".env (env var)",
      "type": "string",
      "defaultValue": null,
      "required": true,
      "description": "Postgres connection string",
      "category": "Database"
    }
  ],
  "configFiles": [".env.example", "next.config.js"],
  "environmentVariables": ["DATABASE_URL", "NODE_ENV", "..."]
}
```

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
{ "configItems": [...], ... }
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/config-doc.ts`. Keep in sync.
