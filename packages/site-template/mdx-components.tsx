import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Mermaid } from "@/components/mermaid";
import { ApiPlayground } from "@/components/api-playground";
import { ForceGraph } from "@/components/force-graph";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Mermaid,
    ApiPlayground,
    ForceGraph,
    ...components,
  };
}
