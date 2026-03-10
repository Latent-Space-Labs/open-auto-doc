/**
 * Escapes MDX-significant characters ({, }, <, >) that appear outside of
 * fenced code blocks (``` ... ```) and inline code spans (` ... `).
 *
 * This prevents the Fumadocs MDX parser (micromark/acorn) from
 * interpreting bare JSON objects, TypeScript generics, etc. as JSX.
 */
export function escapeMdxOutsideCode(mdx: string): string {
  const result: string[] = [];
  let i = 0;
  const len = mdx.length;

  while (i < len) {
    // --- Fenced code block: ``` or more backticks (possibly indented) ---
    if (mdx[i] === "`" && mdx[i + 1] === "`" && mdx[i + 2] === "`" && isStartOfLineOrIndented(mdx, i)) {
      const fenceLen = countBackticks(mdx, i);

      // Copy the opening fence line (backticks + info string)
      // Leading whitespace was already pushed to result char-by-char
      let j = i;
      while (j < len && mdx[j] !== "\n") j++;
      if (j < len) j++; // include the newline
      result.push(mdx.slice(i, j));
      i = j;

      // Copy everything until closing fence or end of string
      const closingFenceRegex = new RegExp(`^\\s*${"`".repeat(fenceLen)}\\s*$`, "m");
      let found = false;
      while (i < len) {
        // Check if current line is the closing fence
        let lineEnd = mdx.indexOf("\n", i);
        if (lineEnd === -1) lineEnd = len;
        const line = mdx.slice(i, lineEnd);

        if (closingFenceRegex.test(line)) {
          // Copy closing fence line
          result.push(mdx.slice(i, lineEnd < len ? lineEnd + 1 : lineEnd));
          i = lineEnd < len ? lineEnd + 1 : lineEnd;
          found = true;
          break;
        }

        // Copy the line as-is (inside code block)
        result.push(mdx.slice(i, lineEnd < len ? lineEnd + 1 : lineEnd));
        i = lineEnd < len ? lineEnd + 1 : lineEnd;
      }

      if (!found) {
        // Unclosed fence — rest of document is code, already copied
      }
      continue;
    }

    // --- Inline code span: ` ... ` ---
    if (mdx[i] === "`") {
      const backtickCount = countBackticks(mdx, i);
      const opener = mdx.slice(i, i + backtickCount);
      result.push(opener);
      i += backtickCount;

      // Find matching closer (same number of backticks, not preceded by more)
      let found = false;
      while (i < len) {
        if (mdx[i] === "`") {
          const closeCount = countBackticks(mdx, i);
          if (closeCount === backtickCount) {
            result.push(mdx.slice(i, i + closeCount));
            i += closeCount;
            found = true;
            break;
          }
          // Different count — copy them literally (still inside code span)
          result.push(mdx.slice(i, i + closeCount));
          i += closeCount;
        } else {
          result.push(mdx[i]);
          i++;
        }
      }

      if (!found) {
        // Unclosed inline code — content already copied as-is
      }
      continue;
    }

    // --- JSX component tag: <Uppercase... /> or <Uppercase>...</Uppercase> ---
    // Skip escaping inside JSX component tags (element name starts with uppercase)
    if (mdx[i] === "<" && i + 1 < len && /[A-Z]/.test(mdx[i + 1])) {
      // Find the end of this JSX element (self-closing /> or opening > then </Name>)
      const jsxStart = i;
      // Extract component name
      let nameEnd = i + 1;
      while (nameEnd < len && /[A-Za-z0-9_.]/.test(mdx[nameEnd])) nameEnd++;
      const componentName = mdx.slice(i + 1, nameEnd);

      // Scan for self-closing /> or opening >
      let depth = 0;
      let j = i;
      while (j < len) {
        if (mdx[j] === "/" && mdx[j + 1] === ">") {
          // Self-closing tag
          if (depth === 0) {
            result.push(mdx.slice(i, j + 2));
            i = j + 2;
            break;
          }
          j += 2;
        } else if (mdx[j] === "<" && mdx[j + 1] === "/" && mdx.slice(j + 2, j + 2 + componentName.length) === componentName) {
          // Closing tag </ComponentName>
          const closeEnd = mdx.indexOf(">", j + 2 + componentName.length);
          if (closeEnd !== -1) {
            result.push(mdx.slice(i, closeEnd + 1));
            i = closeEnd + 1;
            break;
          }
          j++;
        } else if (mdx[j] === "<" && j !== jsxStart && j + 1 < len && /[A-Z]/.test(mdx[j + 1])) {
          // Nested JSX component — track depth
          depth++;
          j++;
        } else if (j === len - 1) {
          // End of string — push remaining
          result.push(mdx.slice(i));
          i = len;
          break;
        } else {
          j++;
        }
      }
      continue;
    }

    // --- Regular text: escape MDX-significant characters ---
    const ch = mdx[i];
    if (ch === "{") {
      result.push("\\{");
    } else if (ch === "}") {
      result.push("\\}");
    } else if (ch === "<") {
      result.push("\\<");
    } else if (ch === ">") {
      result.push("\\>");
    } else {
      result.push(ch);
    }
    i++;
  }

  return result.join("");
}

function isStartOfLineOrIndented(str: string, pos: number): boolean {
  // Walk backward from pos to find start of line, allowing only spaces/tabs
  let j = pos - 1;
  while (j >= 0 && (str[j] === " " || str[j] === "\t")) j--;
  return j < 0 || str[j] === "\n";
}

function countBackticks(str: string, pos: number): number {
  let count = 0;
  while (pos + count < str.length && str[pos + count] === "`") count++;
  return count;
}
