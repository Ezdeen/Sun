/**
 * Money value object — the ONLY way money is represented in the system.
 * Never use `number` for money. Serialized as a plain STRING in JSON
 * (e.g. "12.50") and stored as NUMERIC(14,2) in PostgreSQL.
 */
import { Decimal } from "decimal.js";

export type CurrencyCode = "ILS";

export const DEFAULT_CURRENCY: CurrencyCode = "ILS";

const HUNDRED = new Decimal(100);

/** Round to 2 decimal places, half-up — the single rounding policy for money. */
function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: CurrencyCode
  ) {}

  static fromMajor(value: string | number | Decimal, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    let d: Decimal;
    try {
      d = new Decimal(value);
    } catch {
      throw new MoneyFormatError(String(value));
    }
    if (!d.isFinite()) throw new MoneyFormatError(String(value));
    return new Money(round2(d), currency);
  }

  static fromMinor(minor: bigint, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    if (minor < 0n) throw new MoneyFormatError(`negative minor units: ${minor}`);
    const d = new Decimal(minor.toString()).div(HUNDRED);
    return new Money(round2(d), currency);
  }

  static zero(currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    return new Money(new Decimal(0), currency);
  }

  static sum(items: readonly Money[]): Money {
    if (items.length === 0) return Money.zero();
    return items.reduce((acc, m) => acc.add(m));
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(round2(this.amount.plus(other.amount)), this.currency);
  }

  sub(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(round2(this.amount.minus(other.amount)), this.currency);
  }

  /** Multiply by a dimensionless factor (e.g. 0.5 for a 50% reduction). */
  mul(factor: string | number | Decimal): Money {
    const f = new Decimal(factor);
    return new Money(round2(this.amount.mul(f)), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  isPositive(): boolean {
    return this.amount.isPositive();
  }

  compareTo(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.amount.comparedTo(other.amount) as -1 | 0 | 1;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.eq(other.amount);
  }

  /** Exact integer minor units (agorot): amount × 100, rounded half-up. */
  toMinorUnits(): bigint {
    const minor = this.amount.mul(HUNDRED).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return BigInt(minor.toFixed(0));
  }

  toString(): string {
    return this.amount.toFixed(2);
  }

  toJSON(): string {
    return this.toString();
  }
}

export class MoneyFormatError extends Error {
  constructor(readonly input: string) {
    super(`Invalid money value: ${input}`);
  }
}

export class CurrencyMismatchError extends Error {
  constructor(readonly a: CurrencyCode, readonly b: CurrencyCode) {
    super(`Cannot combine ${a} with ${b}`);
  }
}

/** Parse a money string coming from the DB (NUMERIC) or API (JSON string). */
export function parseMoney(value: string | number | Decimal | null | undefined): Money {
  if (value === null || value === undefined || value === "") {
    throw new MoneyFormatError(String(value));
  }
  return Money.fromMajor(value);
}
