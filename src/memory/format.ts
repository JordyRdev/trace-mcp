import type { Memory } from "./store.js";
import type { Hit } from "./search.js";
import { shortDate } from "../util/time.js";

export function receipt(m: Memory): string {
  const bits: string[] = [];
  if (m.source) bits.push(m.source);
  bits.push(m.evidence.trim() ? `"${m.evidence}"` : "no receipt");
  return bits.join("; ");
}

export function formatHit(h: Hit): string {
  const date = shortDate(h.memory.validFrom ?? h.memory.createdAt);
  const tail = receipt(h.memory);
  return `- [${date}] ${h.memory.text}${tail ? ` (${tail})` : ""}`;
}

export function formatMemory(m: Memory): string {
  const date = shortDate(m.validFrom ?? m.createdAt);
  const flag = m.evidence.trim() ? "" : ", no receipt";
  return `- ${m.text} (${m.id}, ${m.kind}, ${m.status}, ${date}${flag})`;
}
