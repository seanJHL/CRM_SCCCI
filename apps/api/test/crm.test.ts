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
import { gmailGetThread, gmailSendReply } from "../src/lib/google-api";
import { generateOpenRouterReply, OPENROUTER_REPLY_MODEL } from "../src/lib/openrouter";
import type { GmailMessage } from "../src/lib/google-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

  it("requests DeepSeek V4 Flash with masked context and returns an editable reply", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        model: string;
        provider: { data_collection: string };
        messages: Array<{ content: string }>;
      };
      expect(payload.model).toBe(OPENROUTER_REPLY_MODEL);
      expect(payload.provider.data_collection).toBe("deny");
      expect(payload.messages[1]?.content).not.toContain("alex@example.com");
      expect(payload.messages[1]?.content).not.toContain("9123 4567");
      expect(payload.messages[1]?.content).not.toContain("https://example.com/private");
      return Response.json({
        choices: [{ message: { content: "Hi Alex,\n\nMonday at 8:00 PM could work. I’ll confirm shortly.\n\nBest," } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const message = {
      id: "message-ai-1",
      threadId: "thread-ai-1",
      snippet: "Can we meet?",
      labelIds: ["INBOX"],
      bodyText: "Email alex@example.com or call +65 9123 4567. Can we meet Monday at 8 PM? https://example.com/private",
      from: "Alex <alex@example.com>",
      fromName: "Alex",
      fromEmail: "alex@example.com",
      to: "Sean <sean@example.com>",
      subject: "Meeting",
      date: "Mon, 3 Aug 2026 10:00:00 +0800",
      internalDate: "1785722400000",
      messageId: "message-ai-1@example.com",
      references: null,
    } satisfies GmailMessage;

    const reply = await generateOpenRouterReply({
      apiKey: "test-key",
      subject: "Meeting with alex@example.com",
      messages: [message],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(reply).toContain("Monday at 8:00 PM");
  });

  it("retries transient Gmail thread failures before returning an error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "busy" } }, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          id: "thread-1",
          messages: [
            {
              id: "message-1",
              threadId: "thread-1",
              snippet: "Hello",
              labelIds: ["INBOX", "UNREAD"],
              payload: {
                headers: [
                  { name: "From", value: "Alex <alex@example.com>" },
                  { name: "Subject", value: "Hello" },
                ],
                mimeType: "text/plain",
                body: {
                  data: Buffer.from(
                    "Image_block (\nhttps://ablink.example.com/very-long-tracking-link?utm_source=email&token=secret\n)\nHello Sean,\nCan we meet tomorrow?",
                  ).toString("base64url"),
                },
              },
              internalDate: "1785751200000",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const request = gmailGetThread("access-token", "thread-1");
    await vi.runAllTimersAsync();
    const thread = await request;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(thread.id).toBe("thread-1");
    expect(thread.hasUnread).toBe(true);
    expect(thread.messages[0]?.bodyText).toContain("Hello Sean");
    expect(thread.messages[0]?.bodyText).not.toContain("ablink");
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

describe("gmail send", () => {
  it("sends a brand-new message without threading headers and returns the created thread id", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { raw: string; threadId?: string };
      expect(payload.threadId).toBeUndefined();
      const decoded = Buffer.from(
        payload.raw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf-8");
      expect(decoded).not.toContain("In-Reply-To:");
      expect(decoded).not.toContain("References:");
      expect(decoded).toContain("To: alex@example.com");
      expect(decoded).toContain("Subject: Project kickoff");
      return Response.json({ id: "message-new-1", threadId: "thread-new-1", labelIds: ["SENT"] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await gmailSendReply("access-token", {
      to: "alex@example.com",
      subject: "Project kickoff",
      body: "Let's have a call this Tuesday at 12:00 PM.",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual(
      expect.objectContaining({ id: "message-new-1", threadId: "thread-new-1" }),
    );
  });
});
