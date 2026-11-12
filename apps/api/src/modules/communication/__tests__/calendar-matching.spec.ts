import { describe, expect, it } from "vitest";

import { matchContact } from "../application/calendar-service";

/**
 * PHASE-041 T-09 — the contacts-sync matching rules (IN-18, pure): exact
 * email/phone → LINK; fuzzy name similarity → candidates for review;
 * never an auto-merge (the rules only PROPOSE).
 */

const directory = [
  {
    partnerId: "p-exact",
    name: "Al Noor Trading",
    contactEmails: ["ap@alnoor.test"],
    contactPhones: ["+966501111111"],
  },
  {
    partnerId: "p-similar",
    name: "Desert Falcon Contracting",
    contactEmails: ["info@falcon.test"],
    contactPhones: [],
  },
  {
    partnerId: "p-unrelated",
    name: "Global Logistics Services",
    contactEmails: ["ops@global.test"],
    contactPhones: [],
  },
];

describe("contacts-sync matching rules", () => {
  it("EXACT email → a LINK proposal (one partner match)", () => {
    const outcome = matchContact({ email: "ap@alnoor.test", name: "Someone" }, directory);
    expect(outcome).toEqual({ type: "EXACT", partnerId: "p-exact", candidates: [] });
  });

  it("EXACT phone → a LINK proposal (normalized digits)", () => {
    const outcome = matchContact({ phone: "+966 50 111 1111" }, directory);
    expect(outcome).toEqual({ type: "EXACT", partnerId: "p-exact", candidates: [] });
  });

  it("ambiguous matches (two partners on the same email) are NOT exact — no silent pick", () => {
    const ambiguous = [
      ...directory,
      { partnerId: "p-other", name: "Other", contactEmails: ["ap@alnoor.test"], contactPhones: [] },
    ];
    const outcome = matchContact({ email: "ap@alnoor.test" }, ambiguous);
    expect(outcome.type).not.toBe("EXACT");
  });

  it("FUZZY name similarity surfaces candidates best-first (capped at 3)", () => {
    const outcome = matchContact({ name: "Desert Falcon Contracting Co." }, directory);
    expect(outcome.type).toBe("FUZZY");
    expect(outcome.candidates[0]!.partnerId).toBe("p-similar");
    expect(outcome.candidates.length).toBeLessThanOrEqual(3);
  });

  it("unrelated contacts match NOTHING (no forced proposals)", () => {
    const outcome = matchContact({ name: "ZZZ QQQ VVV", email: "nobody@nowhere.test" }, directory);
    expect(outcome).toEqual({ type: "NONE", candidates: [] });
  });

  it("short names never ride the fuzzy path (threshold: ≥ 4 chars)", () => {
    const outcome = matchContact({ name: "Al " }, directory);
    expect(outcome.type).toBe("NONE");
  });
});
