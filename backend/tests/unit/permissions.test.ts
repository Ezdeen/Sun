import { describe, expect, it } from "vitest";
import {
  ROLE_PERMISSIONS,
  ROLES,
  PERMISSIONS,
  roleHas,
  permissionsForRole
} from "../../src/modules/identity/domain/permissions.js";
import { canonicalJson } from "../../src/shared/canonical-json.js";
import { uuidv7 } from "../../src/shared/ids.js";
import { isValidIdNumber, isValidIdNumber as isValidId2 } from "../../src/modules/identity/domain/identity-hash.js";
import * as passwordPolicy from "../../src/modules/identity/domain/password.js";

describe("RBAC matrix (§6.5 / Appendix A.5)", () => {
  it("every role has a non-empty permission list of known permissions", () => {
    for (const role of ROLES) {
      const perms = permissionsForRole(role);
      expect(perms.length).toBeGreaterThan(0);
      for (const p of perms) {
        expect(PERMISSIONS).toContain(p);
      }
    }
  });

  it("separation of duties: finance cannot create shipments or weigh bags (A-002)", () => {
    expect(roleHas("finance", "shipment:create")).toBe(false);
    expect(roleHas("finance", "bag:weigh")).toBe(false);
    expect(roleHas("finance", "invoice:create")).toBe(true);
  });

  it("authority is operational only — no financial access (A-004)", () => {
    expect(roleHas("authority", "ledger:read")).toBe(false);
    expect(roleHas("authority", "invoice:create")).toBe(false);
    expect(roleHas("authority", "request:transition")).toBe(true);
  });

  it("citizen cannot transition requests or see ledger", () => {
    expect(roleHas("citizen", "request:transition")).toBe(false);
    expect(roleHas("citizen", "ledger:read")).toBe(false);
    expect(roleHas("citizen", "payout:read:own")).toBe(true);
  });

  it("manager has every management permission", () => {
    for (const p of ["settings:update", "catalog:manage", "account:manage", "traceability:verify"]) {
      expect(roleHas("manager", p)).toBe(true);
    }
  });

  it("matrix is identical to the seeded JSON (single source of truth)", async () => {
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(
      await readFile(new URL("../../src/modules/seeds/data/permissions.json", import.meta.url), "utf8")
    );
    for (const role of ROLES) {
      expect(raw.roles[role].sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });
});

describe("canonical JSON", () => {
  it("sorts keys recursively and ignores key order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: { y: 1, x: 2 } })).toBe('{"a":{"x":2,"y":1}}');
    expect(canonicalJson([{ z: 1, a: 2 }])).toBe('[{"a":2,"z":1}]');
  });
  it("handles nulls, arrays, strings, numbers deterministically", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson("éش")).toBe('"éش"');
    expect(canonicalJson({ n: null, u: undefined })).toBe('{"n":null}');
  });
});

describe("uuidv7", () => {
  it("produces valid v7 layout and time-ordering", () => {
    const a = uuidv7(1000);
    const b = uuidv7(2000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe("password & identity validation", () => {
  it("password policy", () => {
    expect(passwordPolicy.isStrongPassword("Demo@12345!")).toBe(true);
    expect(passwordPolicy.isStrongPassword("demo12345")).toBe(false);
    expect(passwordPolicy.isStrongPassword("D@mo1")).toBe(false);
    expect(passwordPolicy.isStrongPassword("ABCDEFGH1234!x")).toBe(true);
    expect(passwordPolicy.validatePassword("demo12345").length).toBeGreaterThan(0);
  });
  it("id number validation", () => {
    expect(isValidIdNumber("123456789")).toBe(true);
    expect(isValidIdNumber("12345678")).toBe(false);
    expect(isValidIdNumber("1234567890")).toBe(false);
    expect(isValidId2("abcdefghi")).toBe(false);
  });
});
