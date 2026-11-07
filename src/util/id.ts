import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function newId(prefix = "m"): string {
  let out = "";
  for (const b of randomBytes(10)) out += ALPHABET[b % 32];
  return `${prefix}_${out}`;
}
