import { describe, expect, it } from "vitest";
import {
  inScope,
  matchesRule,
  validScopeRule,
} from "../../src/bounty/scope.js";
import { parseCatalog } from "../../src/bounty/catalog.js";
import { redact } from "../../src/bounty/advisor.js";

describe("program scope", () => {
  it.each([
    ["https://example.com/api", "example.com", true],
    ["https://api.example.com", "example.com", false],
    ["https://api.example.com", "*.example.com", true],
    ["https://example.com", "*.example.com", false],
    ["https://example.com.evil.test", "example.com", false],
    ["https://notexample.com", "example.com", false],
    ["https://example.com/app/users", "https://example.com/app", true],
    ["https://example.com/application", "https://example.com/app", false],
    ["http://example.com/app", "https://example.com/app", false],
    ["https://example.com:8443/app", "https://example.com/app", false],
    ["https://example.com/app/%2e%2e/admin", "https://example.com/app", false],
    ["https://user:password@example.com", "example.com", false],
    ["file:///etc/passwd", "example.com", false],
    [
      "https://example.com/app/%252e%252e/admin",
      "https://example.com/app",
      false,
    ],
  ])("%s matches %s = %s", (target, rule, result) =>
    expect(matchesRule(target, rule)).toBe(result),
  );
  it("exclusions override inclusion", () => {
    const program = {
      inScope: ["*.example.com"],
      outOfScope: ["admin.example.com", "https://api.example.com/private"],
    };
    expect(inScope("https://admin.example.com", program)).toBe(false);
    expect(inScope("https://api.example.com/private/users", program)).toBe(
      false,
    );
    expect(inScope("https://api.example.com/public", program)).toBe(true);
  });
  it.each([
    "--output=secret",
    "https://*.example.com/*",
    "re:example.*",
    "example.com?x=1",
    "example.com bad",
    "javascript:alert(1)",
  ])("rejects ambiguous rule %s", (rule) =>
    expect(validScopeRule(rule)).toBe(false),
  );
});
describe("paid program catalog", () => {
  it("keeps only explicit bounty-eligible web assets in a paying program and retains exclusions", () => {
    const programs = parseCatalog([
      {
        handle: "example",
        name: "Example",
        url: "https://hackerone.com/example",
        offers_bounties: true,
        submission_state: "open",
        targets: {
          in_scope: [
            { asset_identifier: "*.example.com", eligible_for_bounty: true },
            { asset_identifier: "vdp.example.com", eligible_for_bounty: false },
            {
              asset_identifier: "https://github.com/example",
              eligible_for_submission: false,
              eligible_for_bounty: true,
            },
            { asset_identifier: "mobile-app-id", eligible_for_bounty: true },
          ],
          out_of_scope: [
            {
              asset_identifier: "admin.example.com",
              instruction: "Not allowed",
            },
          ],
        },
      },
    ]);
    expect(programs[0].inScope).toEqual(["*.example.com"]);
    expect(programs[0].outOfScope).toEqual(["admin.example.com"]);
    expect(programs[0].omittedAssets).toBe(3);
    expect(programs[0].offersBounties).toBe(true);
  });
});
it("redacts common credentials before advisor context", () => {
  const value = redact(
    "Authorization: Bearer secret\nCookie: auth=secret\nGET /?token=private&name=public\nsk-proj-abcdefghijklmnop",
  );
  expect(value).not.toContain("Bearer secret");
  expect(value).not.toContain("auth=secret");
  expect(value).not.toContain("token=private");
  expect(value).toContain("name=public");
  expect(value).not.toContain("sk-proj-");
});
