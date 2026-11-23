import { describe, expect, it } from "vitest";
import { canGoBack, commit, initial, parse, withScroll } from "./nav-history";

describe("in-app history for Back", () => {
  it("starts with only the current page (no Back into history)", () => {
    const s = initial(null, "/training/exercise/squat", 3);
    expect(canGoBack(s)).toBe(false);
  });

  it("push adds a page; back pops it and returns the scroll to restore", () => {
    let s = initial(null, "/leaderboards?exercise=bench&scope=friends", 1);
    s = withScroll(s, 840);
    const pushed = commit(s, "/u/maya", 2, false);
    expect(canGoBack(pushed.state)).toBe(true);
    const back = commit(pushed.state, "/leaderboards?exercise=bench&scope=friends", 2, true);
    expect(back.restore).toBe(840); // filters are in the URL; scroll comes back
    expect(canGoBack(back.state)).toBe(false);
  });

  it("replace (history length unchanged) swaps the top instead of stacking", () => {
    let s = initial(null, "/lifts", 1);
    s = commit(s, "/lifts/a", 2, false).state;
    s = commit(s, "/lifts/a/edit", 3, false).state;
    s = commit(s, "/lifts/a?saved=1", 3, false).state; // router.replace after saving
    expect(s.stack.map((e) => e.url)).toEqual(["/lifts", "/lifts/a", "/lifts/a?saved=1"]);
  });

  it("a popstate that isn't 'the page below' (forward, or unknown) is treated as a new page", () => {
    let s = initial(null, "/a", 1);
    s = commit(s, "/b", 2, false).state;
    s = commit(s, "/a", 2, true).state; // back
    const fwd = commit(s, "/b", 2, true); // forward
    expect(fwd.restore).toBeNull();
    expect(fwd.state.stack.map((e) => e.url)).toEqual(["/a", "/b"]);
  });

  it("the same URL again (refresh, hash) changes nothing", () => {
    const s = initial(null, "/progress", 4);
    expect(commit(s, "/progress", 4, false).state.stack).toHaveLength(1);
  });

  it("survives a reload only if it still describes this tab", () => {
    let s = initial(null, "/training", 1);
    s = commit(s, "/training/sessions", 2, false).state;
    const raw = JSON.stringify(s);
    expect(canGoBack(initial(parse(raw), "/training/sessions", 2))).toBe(true); // reload
    expect(canGoBack(initial(parse(raw), "/training/sessions", 4))).toBe(false); // an outside page in between
    expect(canGoBack(initial(parse(raw), "/progress", 2))).toBe(false); // different page
    expect(parse("not json")).toBeNull();
    expect(parse('{"stack":[{"url":1}],"len":2}')).toBeNull();
  });

  it("stays bounded", () => {
    let s = initial(null, "/p0", 1);
    for (let i = 1; i <= 80; i++) s = commit(s, `/p${i}`, i + 1, false).state;
    expect(s.stack.length).toBe(50);
    expect(s.stack.at(-1)!.url).toBe("/p80");
  });
});
