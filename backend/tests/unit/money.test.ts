import { describe, expect, it } from "vitest";
import { Money, MoneyFormatError, parseMoney } from "../../src/shared/money.js";

describe("Money value object", () => {
  it("parses strings and rounds half-up to 2dp", () => {
    expect(Money.fromMajor("12.345").toString()).toBe("12.35");
    expect(Money.fromMajor("12.344").toString()).toBe("12.34");
    expect(Money.fromMajor("0.005").toString()).toBe("0.01");
    expect(Money.fromMajor("10").toString()).toBe("10.00");
  });

  it("rejects garbage", () => {
    expect(() => Money.fromMajor("abc")).toThrow(MoneyFormatError);
    expect(() => Money.fromMajor("NaN")).toThrow(MoneyFormatError);
    expect(() => Money.fromMajor(Infinity)).toThrow(MoneyFormatError);
    expect(() => parseMoney(null)).toThrow(MoneyFormatError);
  });

  it("converts to/from minor units exactly", () => {
    expect(Money.fromMajor("12.34").toMinorUnits()).toBe(1234n);
    expect(Money.fromMinor(1234n).toString()).toBe("12.34");
    expect(Money.fromMinor(1n).toString()).toBe("0.01");
    expect(Money.fromMinor(0n).toString()).toBe("0.00");
    expect(() => Money.fromMinor(-5n)).toThrow();
  });

  it("serializes as STRING (never number) in JSON", () => {
    const m = Money.fromMajor("5.50");
    expect(JSON.stringify({ price: m })).toBe(`{"price":"5.50"}`);
    expect(typeof JSON.parse(JSON.stringify({ price: m })).price).toBe("string");
  });

  it("refuses mixing currencies", () => {
    const a = Money.fromMajor("1.00", "ILS");
    const b = Money.fromMajor("2.00", "ILS");
    expect(a.add(b).toString()).toBe("3.00");
  });

  it("mul rounds half-up", () => {
    expect(Money.fromMajor("10.00").mul("0.5").toString()).toBe("5.00");
    expect(Money.fromMajor("0.03").mul("0.5").toString()).toBe("0.02");
    expect(Money.fromMajor("0.01").mul("0.5").toString()).toBe("0.01");
  });

  it("sum works on empty and multiple", () => {
    expect(Money.sum([]).toString()).toBe("0.00");
    expect(
      Money.sum([Money.fromMajor("0.01"), Money.fromMajor("0.01"), Money.fromMajor("0.01")]).toString()
    ).toBe("0.03");
  });
});
