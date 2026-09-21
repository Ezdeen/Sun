import type { Settings } from "../../../settings.js";
import type { Clock } from "../../../shared/clock.js";
import type { RandomSource } from "../../../shared/random.js";
import type { Db } from "../../../shared/db/client.js";
import type { TokenService } from "./token-service.js";

/** Shared dependencies for identity use cases. */
export interface IdentityDeps {
  db: Db;
  settings: Settings;
  clock: Clock;
  random: RandomSource;
  tokens: TokenService;
}

export const REFRESH_COOKIE_NAME = "waste_refresh";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

/** Fixed-cost argon2 verification against a real hash — used when the user
 *  does not exist, so login timing does not reveal account existence. */
export const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=65536,t=3,p=2$bBprj/gB/j24HF0+3UiRJQ$/b704WrId/6ZNXLyd+5s0voVVjDAC8powvnLbj+F7hM";
