import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("health endpoint", () => {
  it("returns ok", async () => {
    const app = createApp();
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

