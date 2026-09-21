import { describe, expect, it } from "vitest";
import {
  formatDateTime, formatDate, formatMoney, formatNumber, formatWeight, shortHash
} from "../lib/format.js";

describe("formatting helpers", () => {
  it("money never goes through Number for display of API strings", () => {
    expect(formatMoney("12.50")).toBe("12.50 ₪");
    expect(formatMoney("0.01")).toBe("0.01 ₪");
    expect(formatMoney("1250.00")).toBe("1250.00 ₪");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });

  it("weight shows 3 decimals + kg label", () => {
    expect(formatWeight("3.5")).toBe("3.500 كجم");
    expect(formatWeight("0.125")).toBe("0.125 كجم");
    expect(formatWeight(null)).toBe("—");
  });

  it("dates degrade gracefully on garbage", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
    expect(formatDate("2026-01-02T10:00:00Z")).toMatch(/2026/);
  });

  it("shortHash truncates long hashes", () => {
    expect(shortHash("CMP-" + "a".repeat(48))).toBe("CMP-aaaaaaaa…");
    expect(shortHash(null)).toBe("—");
    expect(shortHash("CMP-short")).toBe("CMP-short");
  });

  it("formatNumber handles null", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(5)).toBeTruthy();
  });
});
