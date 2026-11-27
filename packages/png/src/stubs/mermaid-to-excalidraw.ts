// Stands in for @excalidraw/mermaid-to-excalidraw, which Excalidraw loads only to convert Mermaid
// text in its editor. Export never reaches it; leaving it out keeps about 4 MiB of Mermaid out of
// the package.
export function parseMermaidToExcalidraw(): never {
  throw new Error("Mermaid conversion is not part of @groundboard/png");
}
