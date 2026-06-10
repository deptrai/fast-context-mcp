import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { labelRole, calculateMatchDensity } from "../deepgrep/src/roles.mjs";

describe("labelRole — heuristic fixtures (AC6)", () => {
  // ── test patterns ──
  it("test: /test/ directory",          () => assert.equal(labelRole({ path: "/project/test/auth.test.js" }),     "test"));
  it("test: .test. filename",           () => assert.equal(labelRole({ path: "/project/src/server.test.mjs" }),   "test"));
  it("test: __tests__/ directory",      () => assert.equal(labelRole({ path: "/project/__tests__/server.js" }),   "test"));
  it("test: /spec/ directory",          () => assert.equal(labelRole({ path: "/project/spec/auth.spec.js" }),     "test"));
  it("test: .spec. filename",           () => assert.equal(labelRole({ path: "/project/src/app.spec.ts" }),       "test"));

  // ── config patterns ──
  it("config: /config/ directory",      () => assert.equal(labelRole({ path: "/project/config/database.js" }),    "config"));
  it("config: .config. filename",       () => assert.equal(labelRole({ path: "/project/src/webpack.config.js" }), "config"));
  it("config: package.json",            () => assert.equal(labelRole({ path: "/project/package.json" }),          "config"));
  it("config: tsconfig.json",           () => assert.equal(labelRole({ path: "/project/tsconfig.json" }),         "config"));

  // ── docs patterns ──
  it("docs: /docs/ directory",          () => assert.equal(labelRole({ path: "/project/docs/api.md" }),           "docs"));
  it("docs: README filename",           () => assert.equal(labelRole({ path: "/project/README.md" }),             "docs"));
  it("docs: .md extension",             () => assert.equal(labelRole({ path: "/project/CHANGELOG.md" }),          "docs"));

  // ── type patterns ──
  it("type: .d.ts extension",           () => assert.equal(labelRole({ path: "/project/types/user.d.ts" }),       "type"));
  it("type: /types/ directory",         () => assert.equal(labelRole({ path: "/project/src/types/auth.ts" }),     "type"));
  it("type: /interfaces/ directory",    () => assert.equal(labelRole({ path: "/project/src/interfaces/IAuth.ts" }), "type"));

  // ── match density ──
  it("implementation: high density (>=0.3)",  () => assert.equal(labelRole({ path: "/project/src/auth.mjs", matchDensity: 0.5 }),  "implementation"));
  it("implementation: exact threshold 0.3",   () => assert.equal(labelRole({ path: "/project/src/auth.mjs", matchDensity: 0.3 }),  "implementation"));
  it("caller: low density (<0.1)",             () => assert.equal(labelRole({ path: "/project/src/utils.mjs", matchDensity: 0.05 }), "caller"));
  it("implementation: mid density (0.1-0.3)",  () => assert.equal(labelRole({ path: "/project/src/server.mjs", matchDensity: 0.2 }),  "implementation"));

  // ── default fallback ──
  it("default: unknown pattern → implementation", () => assert.equal(labelRole({ path: "/project/src/server.mjs" }), "implementation"));
  it("default: empty path → implementation",       () => assert.equal(labelRole({ path: "" }),                       "implementation"));
  it("default: no args → implementation",          () => assert.equal(labelRole({}),                                  "implementation"));

  // ── full_path fallback ──
  it("uses full_path when path absent", () => assert.equal(labelRole({ full_path: "/project/test/auth.test.js" }), "test"));
});

describe("calculateMatchDensity", () => {
  it("returns 0 when query is empty",   () => assert.equal(calculateMatchDensity("auth login\nauth check", ""), 0));
  it("returns 0 when content is empty", () => assert.equal(calculateMatchDensity("", "auth"), 0));
  it("returns 0 when both empty",       () => assert.equal(calculateMatchDensity("", ""), 0));

  it("calculates positive density for matches", () => {
    const content = "auth login\nauth check\nother line\nother\nother";
    const density = calculateMatchDensity(content, "auth");
    assert.ok(density > 0, "density should be > 0");
    assert.ok(density < 1, "density should be < 1");
  });

  it("is case-insensitive", () => {
    const d1 = calculateMatchDensity("AUTH login\nAUTH check", "auth");
    const d2 = calculateMatchDensity("auth login\nauth check", "auth");
    assert.equal(d1, d2);
  });
});
