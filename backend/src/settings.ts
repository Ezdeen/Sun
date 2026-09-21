/**
 * Central, validated application settings.
 * Fails fast (throws) on missing/weak configuration — especially in production.
 * No secret ever gets a usable default value.
 */
import { createHash } from "node:crypto";

export type AppEnv = "development" | "test" | "production";

export interface Settings {
  env: AppEnv;
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  databaseUrl: string;
  jwtSecret: string;
  jwtKeyId: string;
  identityPepper: string;
  identityPepperKid: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  corsOrigins: string[];
  allowCitizenSelfRegistration: boolean;
  demoMode: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`[settings] Missing required environment variable: ${name}`);
  }
  return v.trim();
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`[settings] ${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

const WEAK_SECRETS = new Set(["", "change-me", "secret", "changeme", "placeholder"]);

function secret(name: string, minLength: number, isProd: boolean): string {
  const v = required(name);
  if (isProd && (v.length < minLength || WEAK_SECRETS.has(v.toLowerCase()))) {
    throw new Error(
      `[settings] ${name} is missing, too short (<${minLength} chars) or a known weak value. ` +
        "Production boot aborted. Generate one with: openssl rand -base64 48"
    );
  }
  if (v.length < 16) {
    throw new Error(`[settings] ${name} must be at least 16 characters (got ${v.length})`);
  }
  return v;
}

export function loadSettings(): Settings {
  const envRaw = optional("APP_ENV") ?? optional("NODE_ENV") ?? "development";
  const env: AppEnv =
    envRaw === "production" || envRaw === "test" ? envRaw : "development";
  const isProd = env === "production";

  const corsRaw = optional("CORS_ORIGINS") ?? "";
  const corsOrigins = corsRaw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  if (isProd && corsOrigins.includes("*")) {
    throw new Error("[settings] Wildcard CORS origins are forbidden in production");
  }

  const settings: Settings = {
    env,
    port: int("PORT", 8080, 1, 65535),
    logLevel: (optional("LOG_LEVEL") as Settings["logLevel"]) ?? (isProd ? "info" : "debug"),
    databaseUrl: required("DATABASE_URL"),
    jwtSecret: secret("JWT_SECRET_KEY", 32, isProd),
    jwtKeyId: optional("JWT_KEY_ID") ?? "waste-jwt-2026-01",
    identityPepper: secret("IDENTITY_PEPPER", 32, isProd),
    identityPepperKid: optional("IDENTITY_PEPPER_KID") ?? "waste-pepper-2026-01",
    accessTokenTtlSeconds: int("ACCESS_TOKEN_TTL_SECONDS", 900, 60, 86400),
    refreshTokenTtlDays: int("REFRESH_TOKEN_TTL_DAYS", 14, 1, 365),
    corsOrigins,
    allowCitizenSelfRegistration: bool("ALLOW_CITIZEN_SELF_REGISTRATION", true),
    demoMode: bool("DEMO_MODE", false)
  };

  if (isProd && settings.demoMode) {
    throw new Error("[settings] DEMO_MODE must be false in production. Boot aborted.");
  }

  return settings;
}

/** Deterministic fingerprint of settings (safe to log — no secrets). */
export function settingsFingerprint(s: Settings): string {
  const material = `${s.env}|${s.port}|${s.accessTokenTtlSeconds}|${s.refreshTokenTtlDays}|${s.corsOrigins.join(",")}|${s.allowCitizenSelfRegistration}|${s.demoMode}`;
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}
