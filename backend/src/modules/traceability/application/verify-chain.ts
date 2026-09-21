/**
 * Chain verification (manager + CLI) and public sanitized tracking.
 */
import type { Db } from "../../../shared/db/client.js";
import { loadChain } from "../infrastructure/chain-repo.js";
import { verifyChain, type AggregateType } from "../domain/chain.js";

export async function verifyAggregateChain(
  db: Db,
  aggregateType: AggregateType,
  aggregateId: string
) {
  const events = await loadChain(db, aggregateType, aggregateId);
  const result = verifyChain(events);
  return {
    aggregateType,
    aggregateId,
    valid: result.valid,
    eventsChecked: result.eventsChecked,
    firstBroken: result.firstBroken
  };
}
