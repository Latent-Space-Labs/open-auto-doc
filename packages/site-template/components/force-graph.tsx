"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center rounded-lg border bg-fd-card p-8 text-sm text-fd-muted-foreground">
      Loading graph...
    </div>
  ),
});

interface GraphNode {
  id: string;
  name: string;
  type: "module" | "api" | "component" | "dataModel" | "external" | "repo" | "feature";
  description: string;
  val: number;
  color: string;
  docPath?: string;
  group?: string;
  metadata?: Record<string, unknown>;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  label?: string;
  value?: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface ForceGraphProps {
  graphData: GraphData;
  height?: number;
}

type NodeType = GraphNode["type"];

const TYPE_LABELS: Record<string, string> = {
  module: "Module",
  api: "API",
  component: "Component",
  dataModel: "Data Model",
  external: "External",
  repo: "Repository",
  feature: "Feature",
};

function getLinkId(link: GraphLink): string {
  const s = typeof link.source === "string" ? link.source : link.source.id;
  const t = typeof link.target === "string" ? link.target : link.target.id;
  return `${s}→${t}`;
}

const LINK_TYPE_COLORS: Record<string, { color: string; label: string }> = {
  import: { color: "rgba(59, 130, 246, 0.7)", label: "Import" },
  contains: { color: "rgba(156, 163, 175, 0.5)", label: "Contains" },
  "api-contract": { color: "rgba(34, 197, 94, 0.7)", label: "API Contract" },
  relationship: { color: "rgba(249, 115, 22, 0.7)", label: "Relationship" },
  serves: { color: "rgba(34, 197, 94, 0.6)", label: "Serves" },
  "depends-on": { color: "rgba(107, 114, 128, 0.5)", label: "Depends On" },
  "implemented-by": { color: "rgba(236, 72, 153, 0.7)", label: "Implemented By" },
  "shared-dep": { color: "rgba(107, 114, 128, 0.45)", label: "Shared Dep" },
  integration: { color: "rgba(168, 85, 247, 0.6)", label: "Integration" },
};

export function ForceGraph({ graphData, height = 500 }: ForceGraphProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<{ centerAt: (x: number, y: number, ms: number) => void; zoom: (k: number, ms: number) => void } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height });
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [isDark, setIsDark] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [showLinkLegend, setShowLinkLegend] = useState(false);
  const highlightNodes = useRef(new Set<string>());
  const highlightLinks = useRef(new Set<string>());
  const searchMatchIds = useRef(new Set<string>());

  // Detect dark mode via MutationObserver on <html> class
  useEffect(() => {
    const html = document.documentElement;
    const update = () => setIsDark(html.classList.contains("dark"));
    update();

    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Responsive width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height });
      }
    });
    observer.observe(el);
    setDimensions({ width: el.clientWidth, height });

    return () => observer.disconnect();
  }, [height]);

  // Filter graph data by hidden types
  const filteredGraphData = useMemo(() => {
    if (hiddenTypes.size === 0) return graphData;

    const visibleNodes = graphData.nodes.filter((n) => !hiddenTypes.has(n.type));
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleLinks = graphData.links.filter((l) => {
      const sId = typeof l.source === "string" ? l.source : l.source.id;
      const tId = typeof l.target === "string" ? l.target : l.target.id;
      return visibleIds.has(sId) && visibleIds.has(tId);
    });

    return { nodes: visibleNodes, links: visibleLinks };
  }, [graphData, hiddenTypes]);

  // All unique types from the original (unfiltered) data for legend
  const allTypes = useMemo(() => {
    const types = new Map<NodeType, string>();
    for (const n of graphData.nodes) {
      if (!types.has(n.type)) types.set(n.type, n.color);
    }
    return types;
  }, [graphData.nodes]);

  const toggleType = useCallback((type: NodeType) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Update search match set and focus on first match
  useEffect(() => {
    searchMatchIds.current.clear();
    if (!searchQuery.trim()) return;

    const q = searchQuery.toLowerCase();
    for (const node of filteredGraphData.nodes) {
      if (node.name.toLowerCase().includes(q) || node.description.toLowerCase().includes(q)) {
        searchMatchIds.current.add(node.id);
      }
    }

    // Center on the first match
    if (searchMatchIds.current.size > 0 && fgRef.current) {
      const firstId = searchMatchIds.current.values().next().value;
      const node = filteredGraphData.nodes.find((n) => n.id === firstId);
      if (node?.x != null && node?.y != null) {
        fgRef.current.centerAt(node.x, node.y, 400);
        fgRef.current.zoom(2, 400);
      }
    }
  }, [searchQuery, filteredGraphData.nodes]);

  // All unique link types from the data
  const allLinkTypes = useMemo(() => {
    const types = new Set<string>();
    for (const l of graphData.links) {
      types.add(l.type);
    }
    return types;
  }, [graphData.links]);

  const updateHighlight = useCallback(
    (node: GraphNode | null) => {
      highlightNodes.current.clear();
      highlightLinks.current.clear();

      if (node) {
        highlightNodes.current.add(node.id);
        for (const link of filteredGraphData.links) {
          const sourceId = typeof link.source === "string" ? link.source : link.source.id;
          const targetId = typeof link.target === "string" ? link.target : link.target.id;
          if (sourceId === node.id || targetId === node.id) {
            highlightNodes.current.add(sourceId);
            highlightNodes.current.add(targetId);
            highlightLinks.current.add(getLinkId(link));
          }
        }
      }
    },
    [filteredGraphData.links],
  );

  const handleNodeHover = useCallback(
    (node: GraphNode | null, event?: MouseEvent) => {
      updateHighlight(node);
      setHoverNode(node);
      if (event && node) {
        setTooltipPos({ x: event.clientX, y: event.clientY });
      }
    },
    [updateHighlight],
  );

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.docPath) {
        // Navigate relative to current docs path
        const basePath = window.location.pathname.replace(/\/system-graph\/?$/, "");
        router.push(`${basePath}/${node.docPath}`);
      }
    },
    [router],
  );

  const labelColor = isDark ? "#e5e7eb" : "#374151";
  const labelColorDim = "#9ca3af";

  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isHighlighted = highlightNodes.current.size === 0 || highlightNodes.current.has(node.id);
      const isSearchMatch = searchMatchIds.current.size > 0 && searchMatchIds.current.has(node.id);
      const isDimmedBySearch = searchMatchIds.current.size > 0 && !isSearchMatch;
      const radius = Math.max(Math.sqrt(node.val || 1) * 3, 4);
      const fontSize = Math.max(10 / globalScale, 1);
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isDimmedBySearch ? `${node.color}20` : isHighlighted ? node.color : `${node.color}40`;
      ctx.fill();

      if (isHighlighted && highlightNodes.current.size > 0) {
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // Search match ring
      if (isSearchMatch) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Clickable cursor hint: slightly larger ring on hovered node
      if (hoverNode?.id === node.id && node.docPath) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = `${node.color}60`;
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
      }

      // Label (only show when zoomed in enough, highlighted, or search match)
      if (globalScale > 0.8 || isSearchMatch || (highlightNodes.current.has(node.id) && highlightNodes.current.size > 0)) {
        ctx.font = `${isSearchMatch ? "bold " : ""}${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isDimmedBySearch ? labelColorDim : isHighlighted ? labelColor : labelColorDim;
        ctx.fillText(node.name, x, y + radius + 2 / globalScale);
      }
    },
    [labelColor, labelColorDim, hoverNode],
  );

  const linkCanvasObject = useCallback(
    (link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const linkId = getLinkId(link);
      const isHighlighted = highlightLinks.current.size === 0 || highlightLinks.current.has(linkId);

      const source = link.source as GraphNode;
      const target = link.target as GraphNode;
      if (!source.x || !target.x) return;

      const sx = source.x;
      const sy = source.y ?? 0;
      const tx = target.x;
      const ty = target.y ?? 0;

      // Draw line
      const baseWidth = Math.max((link.value || 1) * 0.5, 0.5);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.lineWidth = (isHighlighted && highlightLinks.current.size > 0 ? baseWidth * 2 : baseWidth) / globalScale;

      if (!isHighlighted) {
        ctx.strokeStyle = "rgba(156, 163, 175, 0.08)";
      } else if (link.type === "import") {
        ctx.strokeStyle = "rgba(59, 130, 246, 0.4)";
      } else if (link.type === "contains") {
        ctx.strokeStyle = "rgba(156, 163, 175, 0.3)";
      } else if (link.type === "api-contract") {
        ctx.strokeStyle = "rgba(34, 197, 94, 0.5)";
      } else if (link.type === "relationship") {
        ctx.strokeStyle = "rgba(249, 115, 22, 0.4)";
      } else if (link.type === "serves") {
        ctx.strokeStyle = "rgba(34, 197, 94, 0.4)";
      } else if (link.type === "depends-on") {
        ctx.strokeStyle = "rgba(107, 114, 128, 0.3)";
      } else if (link.type === "implemented-by") {
        ctx.strokeStyle = "rgba(236, 72, 153, 0.4)";
      } else if (link.type === "shared-dep") {
        ctx.strokeStyle = "rgba(107, 114, 128, 0.25)";
      } else {
        ctx.strokeStyle = "rgba(156, 163, 175, 0.3)";
      }
      ctx.stroke();

      // Draw directional arrow
      const arrowLen = 4 / globalScale;
      const dx = tx - sx;
      const dy = ty - sy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const targetRadius = Math.max(Math.sqrt((target as GraphNode).val || 1) * 3, 4);
        const ratio = (len - targetRadius - 2 / globalScale) / len;
        const ax = sx + dx * ratio;
        const ay = sy + dy * ratio;
        const angle = Math.atan2(dy, dx);

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(
          ax - arrowLen * Math.cos(angle - Math.PI / 6),
          ay - arrowLen * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(
          ax - arrowLen * Math.cos(angle + Math.PI / 6),
          ay - arrowLen * Math.sin(angle + Math.PI / 6),
        );
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }

      // Draw label on highlighted links when zoomed in enough
      if (link.label && isHighlighted && highlightLinks.current.size > 0 && globalScale > 1.2) {
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;
        const labelFontSize = Math.max(7 / globalScale, 0.8);

        ctx.font = `${labelFontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Background for readability
        const textWidth = ctx.measureText(link.label).width;
        const padding = 2 / globalScale;
        ctx.fillStyle = isDark ? "rgba(24, 24, 27, 0.85)" : "rgba(255, 255, 255, 0.85)";
        ctx.fillRect(
          mx - textWidth / 2 - padding,
          my - labelFontSize / 2 - padding,
          textWidth + padding * 2,
          labelFontSize + padding * 2,
        );

        ctx.fillStyle = isDark ? "#d1d5db" : "#6b7280";
        ctx.fillText(link.label, mx, my);
      }
    },
    [isDark],
  );

  if (filteredGraphData.nodes.length === 0) {
    return (
      <div className="my-4 flex items-center justify-center rounded-lg border bg-fd-card p-8 text-sm text-fd-muted-foreground">
        No graph data available.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="my-4 relative rounded-lg border bg-fd-card overflow-hidden">
      {/* Controls overlay */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
        {/* Search input */}
        <div className="rounded-md bg-fd-background/80 backdrop-blur px-3 py-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="w-44 rounded border border-fd-border bg-fd-background px-2 py-1 text-xs font-mono text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-1 focus:ring-fd-ring"
          />
          {searchQuery && (
            <span className="ml-2 text-xs text-fd-muted-foreground">
              {searchMatchIds.current.size} match{searchMatchIds.current.size !== 1 ? "es" : ""}
            </span>
          )}
        </div>

        {/* Node type legend with filter toggles */}
        <div className="flex flex-wrap gap-2 rounded-md bg-fd-background/80 backdrop-blur px-3 py-2 text-xs">
          {Array.from(allTypes.entries()).map(([type, color]) => {
            const isHidden = hiddenTypes.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-opacity ${
                  isHidden ? "opacity-40 line-through" : "opacity-100"
                } hover:bg-fd-muted`}
                title={isHidden ? `Show ${TYPE_LABELS[type]}` : `Hide ${TYPE_LABELS[type]}`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: isHidden ? "#9ca3af" : color }}
                />
                {TYPE_LABELS[type] || type}
              </button>
            );
          })}
          <button
            onClick={() => setShowLinkLegend((v) => !v)}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-opacity hover:bg-fd-muted ${showLinkLegend ? "opacity-100 bg-fd-muted" : "opacity-60"}`}
            title="Toggle link type legend"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 6h8M8 3l2 3-2 3" />
            </svg>
            Links
          </button>
        </div>

        {/* Link type legend */}
        {showLinkLegend && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-fd-background/80 backdrop-blur px-3 py-2 text-xs">
            {Array.from(allLinkTypes).map((type) => {
              const info = LINK_TYPE_COLORS[type];
              if (!info) return null;
              return (
                <span key={type} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-0.5 w-3 rounded shrink-0"
                    style={{ backgroundColor: info.color }}
                  />
                  <span className="text-fd-muted-foreground">{info.label}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <ForceGraph2D
        ref={fgRef}
        graphData={filteredGraphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={(node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
          const radius = Math.max(Math.sqrt(node.val || 1) * 3, 4);
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, radius + 2, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkCanvasObject={linkCanvasObject}
        linkPointerAreaPaint={(link: GraphLink, color: string, ctx: CanvasRenderingContext2D) => {
          const source = link.source as GraphNode;
          const target = link.target as GraphNode;
          if (!source.x || !target.x) return;
          ctx.beginPath();
          ctx.moveTo(source.x, source.y ?? 0);
          ctx.lineTo(target.x, target.y ?? 0);
          ctx.lineWidth = 6;
          ctx.strokeStyle = color;
          ctx.stroke();
        }}
        onNodeHover={handleNodeHover}
        onNodeClick={handleNodeClick}
        cooldownTicks={100}
        enableZoomInteraction={true}
        enablePanInteraction={true}
      />

      {/* Tooltip */}
      {hoverNode && (
        <div
          className="fixed z-50 max-w-xs rounded-md border bg-fd-popover px-3 py-2 text-sm shadow-md pointer-events-none"
          style={{
            left: tooltipPos.x + 12,
            top: tooltipPos.y + 12,
          }}
        >
          <div className="font-medium text-fd-foreground">{hoverNode.name}</div>
          <div className="text-xs text-fd-muted-foreground mt-0.5">
            {TYPE_LABELS[hoverNode.type] || hoverNode.type}
          </div>
          {hoverNode.description && (
            <div className="mt-1 text-xs text-fd-muted-foreground leading-snug">
              {hoverNode.description.length > 150
                ? hoverNode.description.slice(0, 150) + "..."
                : hoverNode.description}
            </div>
          )}
          {hoverNode.docPath && (
            <div className="mt-1.5 text-xs text-fd-primary">Click to view docs</div>
          )}
        </div>
      )}
    </div>
  );
}
