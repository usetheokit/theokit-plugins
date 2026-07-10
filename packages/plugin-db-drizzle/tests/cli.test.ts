/**
 * RED tests for P#5 T2.1 — CLI verb wiring
 *
 * Per plan p5-plugin-db-drizzle v1.0 § Phase 2 / T2.1. 7 verbs:
 * generate/migrate/push/studio/reset/seed/check.
 *
 * Tests assert the buildArgs() factory shapes; child_process spawn is NOT
 * exercised here (integration-test territory).
 */
import { describe, expect, it } from "vitest";

import { buildDbCommands, type DbVerb } from "../src/cli/db.js";
import { resolveOptions } from "../src/options.js";

const REQUIRED_VERBS: readonly DbVerb[] = [
  "generate",
  "migrate",
  "push",
  "studio",
  "reset",
  "seed",
  "check",
];

describe("buildDbCommands (P#5 T2.1) — 7 verbs", () => {
  it("emits exactly 7 commands covering canonical verb set", () => {
    // Given: resolved opts
    const opts = resolveOptions({ driver: "sqlite", url: ":memory:" });

    // When: commands built
    const cmds = buildDbCommands(opts);

    // Then: each canonical verb is present
    expect(cmds).toHaveLength(7);
    const verbs = cmds.map((c) => c.verb).sort();
    expect(verbs).toEqual([...REQUIRED_VERBS].sort());
  });

  it("includes a human-readable summary per verb", () => {
    const opts = resolveOptions({ driver: "sqlite", url: ":memory:" });

    // Then: every command has a non-empty summary
    for (const cmd of buildDbCommands(opts)) {
      expect(cmd.summary.length).toBeGreaterThan(10);
    }
  });

  it("buildArgs returns drizzle-kit args with schema flag for every verb", () => {
    // Given: opts with explicit schemaPath
    const opts = resolveOptions({
      driver: "postgres",
      url: "postgres://x",
      schemaPath: "./custom/schema.ts",
    });

    // Then: every drizzle-kit verb passes --schema (seed is a user-script, #170).
    for (const cmd of buildDbCommands(opts).filter((c) => c.kind === "drizzle-kit")) {
      const args = cmd.buildArgs(opts);
      expect(args[0]).toBe(cmd.verb);
      expect(args).toContain("--schema");
      expect(args).toContain("./custom/schema.ts");
    }
  });

  it("generate verb additionally passes --out pointing at migrationsPath", () => {
    // Given: opts with explicit migrationsPath
    const opts = resolveOptions({
      driver: "postgres",
      url: "postgres://x",
      migrationsPath: "./drizzle/migrations",
    });

    const cmds = buildDbCommands(opts);
    const generate = cmds.find((c) => c.verb === "generate");

    // Then: generate's args contain --out with the custom path
    expect(generate).toBeDefined();
    const args = generate?.buildArgs(opts) ?? [];
    expect(args).toContain("--out");
    expect(args).toContain("./drizzle/migrations");
  });

  it("test_seed_runs_user_script (#170)", () => {
    // `drizzle-kit seed` does not exist — seed must run the user's configured
    // script, flagged kind:"user-script" so the runner spawns it as a script.
    const opts = resolveOptions({ driver: "sqlite", url: ":memory:", seedScript: "./db/seed.ts" });
    const seed = buildDbCommands(opts).find((c) => c.verb === "seed")!;
    expect(seed.kind).toBe("user-script");
    const args = seed.buildArgs(opts);
    expect(args).toContain("./db/seed.ts");
    // NOT the old drizzle-kit passthrough shape.
    expect(args).not.toContain("seed");
    expect(args).not.toContain("--schema");
  });

  it("test_seed_throws_when_no_script_configured (#170)", () => {
    const opts = resolveOptions({ driver: "sqlite", url: ":memory:" }); // no seedScript
    const seed = buildDbCommands(opts).find((c) => c.verb === "seed")!;
    expect(() => seed.buildArgs(opts)).toThrow(/seed.*script/i);
  });

  it("drizzle-kit verbs are kind:'drizzle-kit' (#170)", () => {
    const opts = resolveOptions({ driver: "sqlite", url: ":memory:" });
    for (const verb of ["generate", "migrate", "push", "studio", "check", "reset"] as DbVerb[]) {
      expect(buildDbCommands(opts).find((c) => c.verb === verb)?.kind).toBe("drizzle-kit");
    }
  });

  it("test_connection_opts_forwarded_to_drizzle_kit (#169)", () => {
    const opts = resolveOptions({ driver: "postgres", url: "postgres://h/db" });
    for (const verb of ["migrate", "push", "studio", "check"] as DbVerb[]) {
      const args = buildDbCommands(opts).find((c) => c.verb === verb)!.buildArgs(opts);
      expect(args).toContain("--dialect");
      expect(args).toContain("postgresql"); // driver → dialect mapped (NOT --driver)
      expect(args).toContain("--url");
      expect(args).toContain("postgres://h/db");
    }
  });

  it("generate does NOT receive connection flags (#169)", () => {
    const opts = resolveOptions({ driver: "postgres", url: "postgres://h/db" });
    const args = buildDbCommands(opts).find((c) => c.verb === "generate")!.buildArgs(opts);
    expect(args).not.toContain("--url");
    expect(args).not.toContain("--dialect");
  });

  it("omits --url when url is undefined (no corrupt arg vector) (#169)", () => {
    const opts = resolveOptions({ driver: "sqlite" }); // url omitted
    const args = buildDbCommands(opts).find((c) => c.verb === "migrate")!.buildArgs(opts);
    expect(args).not.toContain("--url");
    expect(args).toContain("--dialect");
    expect(args).toContain("sqlite");
  });

  it("test_reset_requires_force (#168)", () => {
    // The destructive `reset` verb must be FLAGGED as force-requiring so the
    // runner refuses it without --force. (Enforcement is runner-side; here we
    // assert the descriptor carries the guard signal — currently absent.)
    const opts = resolveOptions({ driver: "sqlite", url: ":memory:" });
    const reset = buildDbCommands(opts).find((c) => c.verb === "reset");
    expect(reset?.requiresForce).toBe(true);
    const migrate = buildDbCommands(opts).find((c) => c.verb === "migrate");
    expect(migrate?.requiresForce ?? false).toBe(false);
  });

  it("non-generate verbs do NOT include --out flag", () => {
    const opts = resolveOptions({
      driver: "sqlite",
      url: ":memory:",
      migrationsPath: "./drizzle/migrations",
    });

    // Then: only `generate` writes; other drizzle-kit verbs don't need --out.
    // (seed is a user-script, #170 — excluded from the drizzle-kit arg shape.)
    for (const verb of ["migrate", "push", "studio", "reset", "check"] as DbVerb[]) {
      const cmd = buildDbCommands(opts).find((c) => c.verb === verb);
      const args = cmd?.buildArgs(opts) ?? [];
      expect(args).not.toContain("--out");
    }
  });
});
