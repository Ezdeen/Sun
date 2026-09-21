/**
 * Unit of Work — ONE transaction per use case, committed in ONE place.
 * Repositories and use cases receive the transaction; only the use-case
 * wrapper commits or rolls back.
 */
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgTransaction } from "drizzle-orm/node-postgres";
import type * as schema from "./schema.js";

export type Tx = NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;
export type DbOrTx = NodePgDatabase<typeof schema> | Tx;

export class UnitOfWork {
  private tx?: Tx;
  private done = false;

  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Run `fn` inside a single transaction. The transaction is committed when
   * fn resolves and rolled back when fn rejects. Nested calls reuse the
   * outer transaction.
   */
  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (this.tx) return fn(this.tx);
    if (this.done) throw new Error("[uow] unit of work already finished");
    try {
      const result = await this.db.transaction(async (tx) => {
        this.tx = tx as Tx;
        return await fn(this.tx);
      });
      this.done = true;
      return result;
    } catch (err) {
      this.done = true;
      throw err;
    } finally {
      this.tx = undefined;
    }
  }

  get current(): Tx | undefined {
    return this.tx;
  }
}
