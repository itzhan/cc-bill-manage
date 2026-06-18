import { randomBytes } from "crypto";

// 8 位无歧义字符 (去掉 0 O 1 I l) 的随机 shareId。
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newShareId(): string {
  const buf = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}
