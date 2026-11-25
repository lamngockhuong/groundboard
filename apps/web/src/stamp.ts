import type { ExportStamp } from "./api.ts";
import { dateLocale, t } from "./i18n.ts";

/**
 * When an exported atlas was checked, in words: "Checked 20 Nov 2026, 07:00 at commit abc1234
 * with uncommitted changes". The time is shown in the reader's own time zone.
 */
export function describeStamp(
  stamp: ExportStamp,
  format: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  const when = new Date(stamp.checkedAt).toLocaleString(dateLocale(), format);
  if (stamp.commit === null) return t("stamp.checked", { when });
  return t(stamp.dirty ? "stamp.checkedAtCommitDirty" : "stamp.checkedAtCommit", {
    when,
    commit: stamp.commit,
  });
}
