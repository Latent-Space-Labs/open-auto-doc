---
description: Wave 2 subagent. Catalogues error codes, common errors, debugging tips. Returns ErrorHandlingAnalysis JSON. Failure is non-fatal.
---

# Error handling subagent prompt

You are documenting how this codebase signals and handles errors.

## Investigation guidance

Use Grep to find:
- `throw new` (custom exceptions)
- Error class definitions: `class FooError extends Error`
- HTTP error responses: `res.status(400)`, `HTTPException(404)`, `Response(status_code=500)`
- Error code constants / enums
- Logging calls with `error` / `fatal` level

Use Read to examine error handling middleware, catch blocks, and status mappings.

## Output schema

```jsonc
{
  "errorCodes": [
    {
      "code": "AUTH_INVALID_TOKEN",
      "httpStatus": 401,
      "message": "Token is invalid or expired",
      "description": "Returned when the bearer token cannot be verified",
      "sourceFile": "src/auth/middleware.ts"
    }
  ],
  "commonErrors": [
    {
      "error": "ECONNREFUSED on startup",
      "cause": "Database not running",
      "solution": "Start postgres with `docker compose up -d db`",
      "category": "Setup"
    }
  ],
  "errorClasses": ["AuthError", "ValidationError"],
  "debuggingTips": ["Set LOG_LEVEL=debug to see request bodies"]
}
```

If error handling is minimal, return arrays as empty: `{ "errorCodes": [], "commonErrors": [], "errorClasses": [], "debuggingTips": [] }`.

## Output format

Return your result as a SINGLE fenced JSON code block. No prose before or after:

````
```json
{ "errorCodes": [...], ... }
```
````

## Maintenance note

This prompt mirrors `packages/analyzer/src/agents/error-doc.ts`. Keep in sync.
