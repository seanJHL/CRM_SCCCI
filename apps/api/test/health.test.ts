import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";

const app = createApp();

describe("Health check", () => {
  it("returns ok at root", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("crm-api");
  });

  it("returns health details at /api/health", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("healthy");
  });
});

describe("404 handling", () => {
  it("returns JSON 404 for unknown routes", async () => {
    const res = await app.request("/api/nonexistent");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("CORS headers", () => {
  it("includes Access-Control-Allow-Origin in development", async () => {
    const res = await app.request("/");
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });
});
