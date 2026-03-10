"use client";

import { useState, useCallback } from "react";

interface Parameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  location: "path" | "query" | "header" | "body";
}

interface ApiPlaygroundProps {
  method: string;
  path: string;
  baseUrl?: string;
  parameters?: Parameter[];
  defaultHeaders?: Record<string, string>;
  defaultBody?: string;
}

type KeyValue = { key: string; value: string };

export function ApiPlayground({
  method,
  path,
  baseUrl = "",
  parameters = [],
  defaultHeaders = {},
  defaultBody = "",
}: ApiPlaygroundProps) {
  const [currentBaseUrl, setCurrentBaseUrl] = useState(baseUrl);
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of parameters) {
      initial[p.name] = "";
    }
    return initial;
  });
  const [headers, setHeaders] = useState<KeyValue[]>(() => {
    const entries = Object.entries(defaultHeaders);
    return entries.length > 0
      ? entries.map(([key, value]) => ({ key, value }))
      : [{ key: "Content-Type", value: "application/json" }];
  });
  const [body, setBody] = useState(defaultBody);
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    duration: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"params" | "headers" | "body">("params");

  const hasBody = ["POST", "PUT", "PATCH"].includes(method.toUpperCase());
  const pathParams = parameters.filter((p) => p.location === "path");
  const queryParams = parameters.filter((p) => p.location === "query");
  const headerParams = parameters.filter((p) => p.location === "header");

  const buildUrl = useCallback(() => {
    let url = path;
    // Replace path parameters
    for (const p of pathParams) {
      const val = paramValues[p.name] || `{${p.name}}`;
      url = url.replace(`{${p.name}}`, encodeURIComponent(val));
      url = url.replace(`:${p.name}`, encodeURIComponent(val));
    }
    // Add query parameters
    const queryEntries = queryParams
      .filter((p) => paramValues[p.name])
      .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(paramValues[p.name])}`);
    if (queryEntries.length > 0) {
      url += `?${queryEntries.join("&")}`;
    }
    return url;
  }, [path, pathParams, queryParams, paramValues]);

  const sendRequest = async () => {
    if (!currentBaseUrl) {
      setError("Please enter a base URL");
      return;
    }

    setLoading(true);
    setError("");
    setResponse(null);

    const url = `${currentBaseUrl.replace(/\/$/, "")}${buildUrl()}`;

    const headerObj: Record<string, string> = {};
    for (const h of headers) {
      if (h.key.trim()) headerObj[h.key.trim()] = h.value;
    }
    // Add header params
    for (const p of headerParams) {
      if (paramValues[p.name]) headerObj[p.name] = paramValues[p.name];
    }

    const start = performance.now();

    try {
      const res = await fetch(url, {
        method: method.toUpperCase(),
        headers: headerObj,
        body: hasBody && body.trim() ? body : undefined,
      });

      const duration = Math.round(performance.now() - start);
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });

      let resBody: string;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("json")) {
        const json = await res.json();
        resBody = JSON.stringify(json, null, 2);
      } else {
        resBody = await res.text();
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: resBody,
        duration,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const methodColors: Record<string, string> = {
    GET: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    POST: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    PUT: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    PATCH: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    DELETE: "bg-red-500/15 text-red-700 dark:text-red-400",
  };

  const statusColor = (status: number) => {
    if (status < 300) return "text-emerald-600 dark:text-emerald-400";
    if (status < 400) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  return (
    <div className="my-4 rounded-lg border border-fd-border bg-fd-card overflow-hidden">
      {/* URL bar */}
      <div className="flex items-center gap-2 border-b border-fd-border p-3">
        <span
          className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${methodColors[method.toUpperCase()] || "bg-fd-muted text-fd-muted-foreground"}`}
        >
          {method.toUpperCase()}
        </span>
        <input
          type="text"
          value={currentBaseUrl}
          onChange={(e) => setCurrentBaseUrl(e.target.value)}
          placeholder="https://api.example.com"
          className="min-w-0 flex-1 rounded border border-fd-border bg-fd-background px-2 py-1.5 text-sm font-mono text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-ring"
        />
        <span className="shrink-0 text-sm font-mono text-fd-muted-foreground">
          {buildUrl()}
        </span>
        <button
          onClick={sendRequest}
          disabled={loading}
          className="shrink-0 rounded bg-fd-primary px-4 py-1.5 text-sm font-medium text-fd-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Sending..." : "Send"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-fd-border">
        {(["params", "headers", "body"] as const).map((tab) => {
          if (tab === "body" && !hasBody) return null;
          const count =
            tab === "params"
              ? parameters.length
              : tab === "headers"
                ? headers.filter((h) => h.key).length
                : 0;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-fd-primary text-fd-foreground"
                  : "text-fd-muted-foreground hover:text-fd-foreground"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {count > 0 && (
                <span className="ml-1.5 rounded-full bg-fd-muted px-1.5 py-0.5 text-xs">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="p-3">
        {activeTab === "params" && (
          <div className="space-y-2">
            {parameters.length === 0 ? (
              <p className="text-sm text-fd-muted-foreground">No parameters</p>
            ) : (
              parameters.map((p) => (
                <div key={p.name} className="flex items-start gap-2">
                  <div className="w-36 shrink-0 pt-1.5">
                    <span className="text-sm font-mono font-medium text-fd-foreground">
                      {p.name}
                    </span>
                    {p.required && (
                      <span className="ml-1 text-xs text-red-500">*</span>
                    )}
                    <div className="text-xs text-fd-muted-foreground">
                      {p.location} · {p.type}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={paramValues[p.name] || ""}
                    onChange={(e) =>
                      setParamValues((prev) => ({
                        ...prev,
                        [p.name]: e.target.value,
                      }))
                    }
                    placeholder={p.description || p.name}
                    className="min-w-0 flex-1 rounded border border-fd-border bg-fd-background px-2 py-1.5 text-sm font-mono text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-ring"
                  />
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "headers" && (
          <div className="space-y-2">
            {headers.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={h.key}
                  onChange={(e) => {
                    const next = [...headers];
                    next[i] = { ...next[i], key: e.target.value };
                    setHeaders(next);
                  }}
                  placeholder="Header name"
                  className="w-40 shrink-0 rounded border border-fd-border bg-fd-background px-2 py-1.5 text-sm font-mono text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-ring"
                />
                <input
                  type="text"
                  value={h.value}
                  onChange={(e) => {
                    const next = [...headers];
                    next[i] = { ...next[i], value: e.target.value };
                    setHeaders(next);
                  }}
                  placeholder="Value"
                  className="min-w-0 flex-1 rounded border border-fd-border bg-fd-background px-2 py-1.5 text-sm font-mono text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-ring"
                />
                <button
                  onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                  className="shrink-0 rounded p-1 text-fd-muted-foreground hover:text-red-500 transition-colors"
                  title="Remove header"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              onClick={() => setHeaders([...headers, { key: "", value: "" }])}
              className="text-sm text-fd-primary hover:underline"
            >
              + Add header
            </button>
          </div>
        )}

        {activeTab === "body" && hasBody && (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder='{"key": "value"}'
            rows={8}
            className="w-full rounded border border-fd-border bg-fd-background px-3 py-2 text-sm font-mono text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-ring resize-y"
          />
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Response */}
      {response && (
        <div className="border-t border-fd-border">
          <div className="flex items-center gap-3 px-3 py-2 bg-fd-muted/30">
            <span className="text-sm font-medium">Response</span>
            <span className={`text-sm font-mono font-bold ${statusColor(response.status)}`}>
              {response.status} {response.statusText}
            </span>
            <span className="text-xs text-fd-muted-foreground">
              {response.duration}ms
            </span>
          </div>
          <pre className="max-h-96 overflow-auto p-3 text-sm font-mono text-fd-foreground bg-fd-background">
            <code>{response.body}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
