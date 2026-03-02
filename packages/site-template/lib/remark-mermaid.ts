/**
 * Remark plugin that transforms ```mermaid code blocks into <Mermaid /> JSX components.
 * This runs before Shiki so the mermaid blocks never get syntax-highlighted as code.
 */
export function remarkMermaid() {
  return (tree: any) => {
    walk(tree);
  };
}

function walk(node: any) {
  if (!node.children) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === "code" && child.lang === "mermaid") {
      node.children[i] = {
        type: "mdxJsxFlowElement",
        name: "Mermaid",
        attributes: [
          {
            type: "mdxJsxAttribute",
            name: "code",
            value: child.value,
          },
        ],
        children: [],
        data: { _mdxExplicitJsx: true },
      };
    } else {
      walk(child);
    }
  }
}
