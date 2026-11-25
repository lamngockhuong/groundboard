import type { Issue } from "../api.ts";
import { t, tn } from "../i18n.ts";

/** Board validation issues, each with the JSON path it points at. */
export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <section className="issues" aria-label={t("issues.label")}>
      <h2>{tn("issues.title", issues.length)}</h2>
      <ul>
        {issues.map((issue) => (
          <li key={`${issue.path}\u0000${issue.message}`}>
            <code>{issue.path || "(root)"}</code> {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
