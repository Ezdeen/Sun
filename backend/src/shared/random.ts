/**
 * Randomness abstraction — domain engines never call crypto directly.
 */
import { randomBytes } from "node:crypto";

export interface RandomSource {
  /** n random bytes */
  bytes(n: number): Buffer;
  /** URL-safe random string with ~n bytes of entropy */
  urlToken(n: number): string;
}

export class SystemRandomSource implements RandomSource {
  bytes(n: number): Buffer {
    return randomBytes(n);
  }
  urlToken(n: number): string {
    return randomBytes(n).toString("base64url");
  }
}
