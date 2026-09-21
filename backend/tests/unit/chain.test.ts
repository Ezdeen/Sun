import { describe, expect, it } from "vitest";
import {
  buildEvent,
  computeEventHash,
  genesisHash,
  verifyChain,
  combinedHashRef,
  bagHashRef,
  qrPayloadFor,
  type StoredChainEvent
} from "../../src/modules/traceability/domain/chain.js";

const AGG = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function mkChain(statuses: string[], base = AGG): StoredChainEvent[] {
  const events: StoredChainEvent[] = [];
  let prev = genesisHash(base);
  statuses.forEach((statusCode, i) => {
    const ev = buildEvent({
      aggregateType: "request",
      aggregateId: base,
      seq: i + 1,
      statusCode,
      actorRole: "system",
      actorRef: null,
      payload: { note: `event ${i + 1}` },
      occurredAt: new Date(Date.UTC(2026, 0, 1, 10, 0, i)),
      prevHash: prev
    });
    events.push(ev);
    prev = ev.eventHash;
  });
  return events;
}

describe("traceability chain (§6.3)", () => {
  it("genesis prev_hash format", () => {
    expect(genesisHash(AGG)).toBe(`GENESIS:${AGG}`);
  });

  it("valid chain verifies", () => {
    const chain = mkChain(["received", "sent_to_collector", "on_the_way"]);
    const result = verifyChain(chain);
    expect(result.valid).toBe(true);
    expect(result.eventsChecked).toBe(3);
    expect(result.firstBroken).toBeNull();
  });

  it("GOLDEN VECTOR: hash is stable and canonical", () => {
    const ev = buildEvent({
      aggregateType: "request",
      aggregateId: AGG,
      seq: 1,
      statusCode: "received",
      actorRole: "citizen",
      actorRef: "CIT-" + "ab".repeat(24),
      payload: { request_number: 1, lines: 2, estimated_total: "5.50" },
      occurredAt: new Date("2026-01-01T10:00:00.000Z"),
      prevHash: genesisHash(AGG),
      schemaVersion: 1
    });
    // Deterministic across runs (canonical JSON + sorted keys)
    const again = buildEvent({
      aggregateType: "request",
      aggregateId: AGG,
      seq: 1,
      statusCode: "received",
      actorRole: "citizen",
      actorRef: "CIT-" + "ab".repeat(24),
      payload: { estimated_total: "5.50", lines: 2, request_number: 1 }, // KEY ORDER SWAPPED
      occurredAt: new Date("2026-01-01T10:00:00.000Z"),
      prevHash: genesisHash(AGG),
      schemaVersion: 1
    });
    expect(ev.eventHash).toBe(again.eventHash);
    expect(ev.eventHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tampered payload is detected (hash_mismatch)", () => {
    const chain = mkChain(["received", "collected"]);
    const tampered: StoredChainEvent = {
      ...chain[1]!,
      payload: { note: "TAMPERED" }
    };
    const result = verifyChain([chain[0]!, tampered]);
    expect(result.valid).toBe(false);
    expect(result.firstBroken?.seq).toBe(2);
    expect(result.firstBroken?.reason).toBe("hash_mismatch");
  });

  it("broken linkage is detected (prev_hash_mismatch)", () => {
    const chain = mkChain(["received", "collected", "sorted"]);
    // Replace event 3's prevHash with garbage
    const broken: StoredChainEvent = { ...chain[2]!, prevHash: "deadbeef" };
    const result = verifyChain([chain[0]!, chain[1]!, broken]);
    expect(result.valid).toBe(false);
    expect(result.firstBroken?.reason).toBe("prev_hash_mismatch");
    expect(result.firstBroken?.seq).toBe(3);
  });

  it("seq gap is detected", () => {
    const chain = mkChain(["received", "collected"]);
    const gapped: StoredChainEvent = { ...chain[1]!, seq: 5 };
    const result = verifyChain([chain[0]!, gapped]);
    expect(result.valid).toBe(false);
    expect(result.firstBroken?.reason).toBe("seq_gap");
  });

  it("replacing an event's hash keeps linkage but fails recompute", () => {
    const chain = mkChain(["received", "collected"]);
    const forged: StoredChainEvent = {
      ...chain[1]!,
      statusCode: "sorted",
      eventHash: computeEventHash(chain[1]!)
    };
    const result = verifyChain([chain[0]!, forged]);
    expect(result.valid).toBe(false);
    expect(result.firstBroken?.reason).toBe("hash_mismatch");
  });

  it("empty chain is valid", () => {
    expect(verifyChain([]).valid).toBe(true);
  });
});

describe("hash reference formats (§6.3 — old barcode prefixes preserved)", () => {
  it("combined/bag/qr formats", () => {
    const cmp = combinedHashRef("CIT-" + "cd".repeat(24), AGG);
    expect(cmp.startsWith("CMP-")).toBe(true);
    expect(cmp.length).toBe(52); // CMP- + 48
    expect(combinedHashRef("CIT-x", "a")).not.toBe(combinedHashRef("CIT-x", "b"));

    const bag = bagHashRef("bag-id-1");
    expect(bag.startsWith("BAG-")).toBe(true);
    expect(bag.length).toBe(28); // BAG- + 24

    expect(qrPayloadFor(cmp)).toBe(`WASTE-QR:v1:${cmp}`);
  });
});
