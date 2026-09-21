/**
 * Clock abstraction — domain engines never call Date.now() directly.
 * Inject a fixed clock in tests for determinism.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private readonly at: Date) {}
  now(): Date {
    return this.at;
  }
}
