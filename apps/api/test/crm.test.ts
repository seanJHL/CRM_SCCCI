import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseSchedulingText,
  suggestAlternativeSlots,
} from "../src/lib/scheduler";
import { classifyEmail } from "../src/lib/email-classifier";
import { generateReply } from "../src/lib/reply-generator";
import { maskPii } from "../src/lib/pii-masker";
import {
  decryptToken,
  encryptToken,
  generateSessionToken,
  hashToken,
  secureEqual,
} from "../src/lib/crypto";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("natural-language scheduling", () => {
  it("interprets an unqualified Monday in the user's timezone and marks it ambiguous", () => {
    const parsed = parseSchedulingText(
      "I am free at 8:00 PM on Monday.",
      "Asia/Singapore",
      new Date("2026-08-02T04:00:00.000Z"),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.start).toBe("2026-08-03T12:00:00.000Z");
    expect(parsed?.end).toBe("2026-08-03T12:30:00.000Z");
    expect(parsed?.isAmbiguous).toBe(true);
    expect(parsed?.interpretation).toBe("Monday, 3 August 2026 at 8:00 PM");
  });

  it("suggests slots using user-local working hours rather than Worker UTC", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ calendars: { primary: { busy: [] } } }),
      ),
    );

    const slots = await suggestAlternativeSlots(
      "access-token",
      "2026-08-03T00:00:00.000Z",
      30,
      "Asia/Singapore",
      { start: "09:00", end: "18:00" },
      2,
    );

    expect(slots.map((slot) => slot.start)).toEqual([
      "2026-08-03T01:00:00.000Z",
      "2026-08-03T01:30:00.000Z",
    ]);
  });

  it("handles relative and incomplete phrases with clear ambiguity", () => {
    const now = new Date("2026-08-02T04:00:00.000Z");
    const nextMonday = parseSchedulingText(
      "next Monday at 8 PM",
      "Asia/Singapore",
      now,
    );
    const tomorrowEvening = parseSchedulingText(
      "tomorrow evening",
      "Asia/Singapore",
      now,
    );
    const afterThree = parseSchedulingText(
      "after 3:00 PM",
      "Asia/Singapore",
      now,
    );

    expect(nextMonday?.interpretation).toContain("Monday, 3 August 2026");
    expect(nextMonday?.isAmbiguous).toBe(false);
    expect(tomorrowEvening?.interpretation).toContain("Monday, 3 August 2026");
    expect(afterThree?.isAmbiguous).toBe(true);
    expect(afterThree?.ambiguityReason).toBe("A date was not specified.");
  });
});

describe("email intelligence", () => {
  it("classifies urgent response requests and explains why", () => {
    const result = classifyEmail(
      "Urgent: approval required today",
      "client@example.com",
      "Could you confirm the proposal by 3 PM?",
    );
    expect(result.priority).toBe("critical");
    expect(result.requiresResponse).toBe(true);
    expect(result.importanceReasons.length).toBeGreaterThan(1);
  });

  it("generates a scheduling draft without sending or calling an external AI", () => {
    const reply = generateReply({
      category: "scheduling",
      subject: "Catch-up next Monday",
      senderName: "Alex",
      myName: "Sam",
      latestMessage: "Could we meet at 8 PM next Monday?",
    });
    expect(reply.body).toContain("Hi Alex");
    expect(reply.body).toContain("proposed timing");
    expect(reply.body).toContain("Sam");
  });
});

describe("privacy and token protection", () => {
  it("masks common personal and credential patterns", () => {
    const masked = maskPii(
      "Email alex@example.com, call +65 9123 4567, token ya29.secretvalue",
    );
    expect(masked).not.toContain("alex@example.com");
    expect(masked).not.toContain("9123 4567");
    expect(masked).not.toContain("ya29.secretvalue");
  });

  it("round-trips OAuth tokens with AES-GCM and HMAC-hashes sessions", async () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const encrypted = await encryptToken("oauth-secret", key);
    expect(encrypted).not.toContain("oauth-secret");
    expect(await decryptToken(encrypted, key)).toBe("oauth-secret");

    const session = generateSessionToken();
    expect(session.length).toBeGreaterThan(32);
    expect(await hashToken(session, "a-dedicated-session-secret")).not.toContain(
      session,
    );
    expect(await secureEqual("same", "same")).toBe(true);
    expect(await secureEqual("same", "different")).toBe(false);
  });
});
