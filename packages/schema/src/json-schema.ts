import * as z from "zod";
import { BoardShape } from "./board.ts";

/**
 * JSON Schema (draft 2020-12) for the board as an LLM or another client writes it.
 * Cross-reference and grounding rules cannot be expressed in JSON Schema; they are
 * summarised in the description and enforced by `parseBoard`.
 */
export function boardJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(BoardShape, { io: "input", target: "draft-2020-12" });
  return {
    $schema: schema.$schema,
    $id: "https://github.com/lamngockhuong/groundboard/blob/main/packages/schema/board.schema.json",
    title: "groundboard board",
    description:
      "A source-grounded knowledge board. Ids are unique per collection; edges connect node ids; " +
      "a node's groupId and a group's parentId name group ids; group nesting is acyclic and at most 4 levels deep. " +
      "An element has no groupId; a screen has one only when it has no elements and no states. " +
      "Sources are code (the default kind), or specification: doc (a document in the repository, with line and quote), " +
      "figma, mockup (a label, and a path when the file is in the repository) and link (an https document outside the repository). " +
      "Nodes of kind step, state, decision, cause, rejected, fact and screen must cite at least one source, " +
      "and every code source they cite must carry a non-empty quote copied from the cited lines. " +
      "A screen needs ref, platform and layoutFrom (figma, screenshot, mockup, doc or code); layoutFrom code needs a cited code source, " +
      "and a screen with layoutFrom doc has no elements. " +
      "A screen with stateOf (the id of another screen on the board, which is not itself a state) draws one state of that screen: " +
      "it has no ref, its platform and layoutFrom are the root's, and its elements' refs extend the root's ref. " +
      "An element's parentId names its screen or containing element " +
      "(acyclic, at most 8 levels deep), and its ref extends its screen's ref. An interactive element " +
      "(button, link, input, checkbox, or the start of a navigates edge) needs an action citing a source that can back behaviour " +
      "(a quoted code source, a doc, a figma node, a mockup with a path, or a link with a quote), or unresolved. " +
      "An edge has exactly one of to and toRef; toRef is only for navigates edges, which must cite a source that can back behaviour. " +
      "A transition edge that ends at a screen starts at that screen, one of its states or one of their elements, and must cite a source that can back behaviour. " +
      "A claim is grounded in code when it cites a quoted code source, in the specification when it cites only specification sources.",
    ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$schema")),
  };
}

export function boardJsonSchemaText(): string {
  return `${JSON.stringify(boardJsonSchema(), null, 2)}\n`;
}
