import { describe, expect, it } from "vitest";
import { classifyRequestRef, isUuid } from "../../src/modules/traceability/domain/reference.js";

const HEX = "ab".repeat(24); // 48 hex chars
const UUID = "0198c1f0-7b1a-7c2e-9d3f-1a2b3c4d5e6f";

describe("request reference parser (manager verify-chain)", () => {
  it("UUID → id (lower-cased)", () => {
    expect(classifyRequestRef(UUID.toUpperCase())).toEqual({ kind: "id", value: UUID });
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid("CMP-x")).toBe(false);
  });

  it("CMP-… → combined_hash (canonical case, whitespace trimmed)", () => {
    expect(classifyRequestRef(`  cmp-${HEX.toUpperCase()}  `)).toEqual({
      kind: "combined_hash",
      value: `CMP-${HEX}`
    });
  });

  it("REQ-… → request_hash", () => {
    expect(classifyRequestRef(`REQ-${HEX}`)).toEqual({ kind: "request_hash", value: `REQ-${HEX}` });
  });

  it("QR payloads resolve to the combined hash (request and bag payloads)", () => {
    expect(classifyRequestRef(`WASTE-QR:v1:CMP-${HEX}`)).toEqual({ kind: "combined_hash", value: `CMP-${HEX}` });
    expect(classifyRequestRef(`WASTE-QR:v1:CMP-${HEX}:${UUID}`)).toEqual({
      kind: "combined_hash",
      value: `CMP-${HEX}`
    });
  });

  it("request number (plain, #, Arabic-Indic digits)", () => {
    expect(classifyRequestRef("1004")).toEqual({ kind: "request_number", value: 1004 });
    expect(classifyRequestRef("#1004")).toEqual({ kind: "request_number", value: 1004 });
    expect(classifyRequestRef("١٠٠٤")).toEqual({ kind: "request_number", value: 1004 });
  });

  it("garbage / truncated / oversized → invalid", () => {
    for (const bad of ["", "   ", "CMP-short", "REQ-zz", "abc", "12a", "x".repeat(300), "1'; DROP TABLE"]) {
      expect(classifyRequestRef(bad)).toEqual({ kind: "invalid" });
    }
  });
});
