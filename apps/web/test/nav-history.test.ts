import { describe, expect, it } from "vitest";
import {
  canBack,
  canForward,
  currentEntry,
  go,
  goTo,
  type NavEntry,
  type NavStack,
  push,
  replaceRoute,
  saveView,
  startStack,
  stateId,
} from "../src/nav-history.ts";

const entry = (id: string): NavEntry => ({ id, route: { view: "board", slug: id } });

/** A stack of the given ids, standing on the last one. */
function stackOf(...ids: string[]): NavStack {
  let stack = startStack(entry(ids[0] as string));
  for (const id of ids.slice(1)) stack = push(stack, entry(id));
  return stack;
}

const ids = (stack: NavStack) => stack.entries.map((e) => e.id);
const view = { scrollX: 10, scrollY: -20, zoom: 1.5, selected: ["n1"] };

describe("nav-history", () => {
  it("pushes a new place and drops the entries ahead of the current one", () => {
    const back = go(stackOf("a", "b", "c"), -2);
    expect(currentEntry(back)?.id).toBe("a");
    const next = push(back, entry("d"));
    expect(ids(next)).toEqual(["a", "d"]);
    expect(next.index).toBe(1);
    expect(canForward(next)).toBe(false);
  });

  it("never goes past either end", () => {
    const stack = stackOf("a", "b");
    expect(go(stack, 1)).toBe(stack);
    expect(go(stack, -5).index).toBe(0);
    expect(canBack(go(stack, -5))).toBe(false);
    expect(canForward(go(stack, -1))).toBe(true);
  });

  it("goes to an entry by id, and stays put on an unknown one", () => {
    const stack = stackOf("a", "b", "c");
    expect(goTo(stack, "a").index).toBe(0);
    expect(goTo(stack, "zz")).toBe(stack);
  });

  it("saves a view on that entry only, without changing the stack it was given", () => {
    const stack = stackOf("a", "b");
    const saved = saveView(stack, "a", view);
    expect(saved.entries[0]?.view).toEqual(view);
    expect(saved.entries[1]?.view).toBeUndefined();
    expect(stack.entries[0]?.view).toBeUndefined();
    expect(saveView(stack, "zz", view)).toBe(stack);
  });

  it("keeps 100 entries, dropping the oldest, and stays on the newest", () => {
    let stack = startStack(entry("e0"));
    for (let i = 1; i <= 120; i += 1) stack = push(stack, entry(`e${i}`));
    expect(stack.entries).toHaveLength(100);
    expect(stack.entries[0]?.id).toBe("e21");
    expect(currentEntry(stack)?.id).toBe("e120");
    expect(stack.index).toBe(99);
  });

  it("keeps the index on the right entry when the limit drops the oldest", () => {
    const stack = push(go(stackOf("a", "b", "c"), -1), entry("d"), 2);
    expect(ids(stack)).toEqual(["b", "d"]);
    expect(currentEntry(stack)?.id).toBe("d");
  });

  it("replaces the route of the current entry and forgets its view", () => {
    const stack = saveView(stackOf("a"), "a", view);
    const replaced = replaceRoute(stack, { view: "home" });
    expect(currentEntry(replaced)).toEqual({ id: "a", route: { view: "home" } });
  });

  it("reads the entry id from history.state, and nothing from a state of another kind", () => {
    expect(stateId({ gb: "x-1" })).toBe("x-1");
    expect(stateId(null)).toBeNull();
    expect(stateId({ gb: 3 })).toBeNull();
    expect(stateId("gb")).toBeNull();
  });
});
