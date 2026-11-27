// Option C prototype: no image. Prints what a reviewer would be given instead: each frame, its
// shapes in reading order (top to bottom, then left to right, as laid out), and every arrow as
// "from -> to". Reads the rendered scene so the order is the drawn order, not the IR's.
//
//   node render-c.mjs <scene.excalidraw>
import { readFile } from "node:fs/promises";

const scene = JSON.parse(await readFile(process.argv[2], "utf8"));
const els = scene.elements.filter((e) => !e.isDeleted);
const byId = new Map(els.map((e) => [e.id, e]));
const labelOf = (e) => {
  const bound = (e.boundElements ?? []).find((b) => b.type === "text");
  const text = bound ? byId.get(bound.id)?.text : e.text;
  return (text ?? e.name ?? e.id).replace(/\s*\n\s*/g, " ");
};
const shapes = els.filter((e) => ["rectangle", "diamond", "ellipse"].includes(e.type) && e.customData?.groundboard?.nodeId);
const frames = els.filter((e) => e.type === "frame").sort((a, b) => a.x - b.x || a.y - b.y);
const order = (a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x;

const loose = els.filter((e) => e.type === "text" && !e.containerId && !e.frameId).sort(order);
for (const t of loose.slice(0, 3)) console.log(t.text);
for (const f of frames) {
  const inside = shapes.filter((s) => s.frameId === f.id).sort(order);
  if (!inside.length) continue;
  console.log(`\n[${f.name}]`);
  for (const s of inside) console.log(`  - (${s.customData.groundboard.kind}) ${labelOf(s)}`);
}
console.log("\nArrows:");
for (const a of els.filter((e) => e.type === "arrow" && e.startBinding && e.endBinding)) {
  const from = byId.get(a.startBinding.elementId);
  const to = byId.get(a.endBinding.elementId);
  const label = (a.boundElements ?? []).find((b) => b.type === "text");
  const kind = a.customData?.groundboard?.kind;
  console.log(`  ${labelOf(from)} -> ${labelOf(to)}${label ? ` [${byId.get(label.id).text}]` : ""}${kind && kind !== "flow" ? ` (${kind})` : ""}`);
}
