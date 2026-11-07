import type { Memory } from "./store.js";
import { shortDate } from "../util/time.js";

const KINDS: Memory["kind"][] = ["identity", "preference", "fact", "event"];

export function exportJsonl(memories: Memory[]): string {
  return memories.map((m) => JSON.stringify(m)).join("\n") + "\n";
}

export function exportMarkdown(memories: Memory[]): string {
  const active = memories.filter((m) => m.status === "active");
  const pending = memories.filter((m) => m.status === "pending");
  const lines: string[] = ["# Memory export", "", `Generated ${new Date().toISOString()}`, ""];

  for (const kind of KINDS) {
    const group = active.filter((m) => m.kind === kind);
    if (!group.length) continue;
    lines.push(`## ${kind[0].toUpperCase()}${kind.slice(1)}`, "");
    for (const m of group) {
      const date = shortDate(m.validFrom ?? m.createdAt);
      const source = m.source ? `, via ${m.source}` : "";
      lines.push(`- ${m.text} (${date}${source})`);
      if (m.evidence) lines.push(`  > ${m.evidence}`);
    }
    lines.push("");
  }

  if (pending.length) {
    lines.push("## Pending review", "");
    for (const m of pending) lines.push(`- ${m.text} (${m.id})`);
    lines.push("");
  }

  return lines.join("\n");
}
