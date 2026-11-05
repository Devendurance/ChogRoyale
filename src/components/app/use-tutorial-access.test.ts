import { describe, expect, it, vi } from "vitest";
import { readTutorialProgress } from "./use-tutorial-access";

const tutorial = { stage: 1, completedStages: 1, graduated: false, grandfathered: false, nextStage: 2, enforcement: true, access: "training-required" };

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(body === undefined ? "not json" : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("readTutorialProgress", () => {
  it("returns the server view and sends the token only in the header", async () => {
    const fetcher = respond(200, { success: true, data: { tutorial } });
    await expect(readTutorialProgress("tok", fetcher)).resolves.toEqual({ state: "ready", tutorial });
    expect(fetcher).toHaveBeenCalledWith("/api/players/me/tutorial", { headers: { authorization: "Bearer tok" }, cache: "no-store" });
  });

  it("keeps session, setup and service failures distinct and never invents 0/3", async () => {
    await expect(readTutorialProgress("t", respond(401, {}))).resolves.toEqual({ state: "session" });
    expect((await readTutorialProgress("t", respond(403, {}))).state).toBe("locked");
    expect(await readTutorialProgress("t", respond(503, { success: false, error: { message: "Training Camp progress is not available yet" } }))).toEqual({
      state: "unavailable",
      message: "Training Camp progress is not available yet",
    });
    expect((await readTutorialProgress("t", respond(200, undefined))).state).toBe("unavailable");
    expect((await readTutorialProgress("t", respond(200, { success: true, data: {} }))).state).toBe("unavailable");
  });

  it("reports a network failure as unavailable", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect((await readTutorialProgress("t", fetcher)).state).toBe("unavailable");
  });
});
