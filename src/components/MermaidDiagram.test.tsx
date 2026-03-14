import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MermaidDiagram } from "./MermaidDiagram";

describe("MermaidDiagram", () => {
  it("renders the mermaid container with header", () => {
    const code = "graph TD\n  A-->B";
    const html = renderToStaticMarkup(<MermaidDiagram code={code} />);

    // Should have the mermaid label in header
    expect(html).toContain("mermaid");
    // Should have the container structure
    expect(html).toContain("not-prose");
    expect(html).toContain("group/code");
  });

  it("includes copy button in header", () => {
    const code = "graph TD\n  A-->B";
    const html = renderToStaticMarkup(<MermaidDiagram code={code} />);

    // CopyButton should be rendered
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover/code:opacity-100");
  });
});
