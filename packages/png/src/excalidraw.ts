// Excalidraw's export, bundled into this package at build time: the published build uses
// extensionless and JSON imports that Node's ESM loader refuses. Import it only after
// `installDom()`.
export { exportToSvg } from "@excalidraw/excalidraw";
