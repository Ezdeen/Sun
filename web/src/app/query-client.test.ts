import { describe, expect, it } from "vitest";
import type { Query } from "@tanstack/react-query";
import { POLL_BACKOFF_MS, POLL_MS, createQueryClient, pollInterval } from "./query-client.js";

const q = (status: "success" | "error") => ({ state: { status } }) as unknown as Query;

describe("query client — live data defaults", () => {
  it("polls every query on an interval, on focus and on reconnect", () => {
    const d = createQueryClient().getDefaultOptions().queries!;
    expect(d.refetchInterval).toBe(pollInterval);
    expect(d.refetchOnWindowFocus).toBe(true);
    expect(d.refetchOnReconnect).toBe(true);
  });

  it("never polls a hidden tab", () => {
    expect(createQueryClient().getDefaultOptions().queries!.refetchIntervalInBackground).toBe(false);
  });

  it("uses the normal rate when healthy and backs off after an error", () => {
    expect(pollInterval(q("success"))).toBe(POLL_MS);
    expect(pollInterval(q("error"))).toBe(POLL_BACKOFF_MS);
    expect(POLL_BACKOFF_MS).toBeGreaterThan(POLL_MS);
  });

  it("slows down reference data and the rate-limited public tracker", () => {
    const c = createQueryClient();
    expect(c.getQueryDefaults(["catalog"]).refetchInterval).toBe(60_000);
    const track = c.getQueryDefaults(["track", "abc"]).refetchInterval as number;
    // server allows 20/min per IP; one poll per 30 s keeps a shared NAT well under that
    expect(track).toBeGreaterThanOrEqual(30_000);
  });
});
