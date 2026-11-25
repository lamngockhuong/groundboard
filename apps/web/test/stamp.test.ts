import { describe, expect, it } from "vitest";
import { describeStamp } from "../src/stamp.ts";

const utc: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
};
const checkedAt = "2026-11-20T07:00:00.000Z";
const when = new Date(checkedAt).toLocaleString(undefined, utc);

describe("describeStamp", () => {
  it("names the time, the commit and uncommitted changes", () => {
    const stamp = { checkedAt, commit: "4f5a346", dirty: false, version: "0.1.0" };
    expect(describeStamp(stamp, utc)).toBe(`Checked ${when} at commit 4f5a346`);
    expect(describeStamp({ ...stamp, dirty: true }, utc)).toBe(
      `Checked ${when} at commit 4f5a346 with uncommitted changes`,
    );
    expect(describeStamp({ ...stamp, commit: null }, utc)).toBe(`Checked ${when}`);
  });
});
