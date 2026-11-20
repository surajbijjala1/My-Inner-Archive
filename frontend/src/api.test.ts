import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, getEntries, getToken, isOffline, login, sendChat, setSessionExpiredHandler, setToken,
  storageGet, storageRemove, storageSet,
} from "./api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function answer(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The app's one session-expired listener. */
function expiredHandler() {
  const handler = vi.fn();
  setSessionExpiredHandler(handler);
  return handler;
}

afterEach(() => setSessionExpiredHandler(null));

/** Run a request and hand back what it threw. */
async function failure(request: Promise<unknown>): Promise<ApiError> {
  try {
    await request;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected the request to fail");
}

describe("authFetch: what a failed request turns into", () => {
  it("reports no answer at all as offline (status 0), without signing out", async () => {
    setToken("t");
    const expired = expiredHandler();
    answer(new TypeError("Failed to fetch"));
    const err = await failure(getEntries());
    expect(err.status).toBe(0);
    expect(isOffline(err)).toBe(true);
    expect(expired).not.toHaveBeenCalled();
    expect(getToken()).toBe("t");
  });

  it("treats a 200 that isn't JSON as offline rather than as data", async () => {
    setToken("t");
    answer(new Response("<html>proxy error</html>", { status: 200 }));
    expect((await failure(getEntries())).status).toBe(0);
  });

  it("signs the user out on a 401 from a signed-in request", async () => {
    setToken("expired");
    const expired = expiredHandler();
    answer(json(401, { error: "Invalid token" }));
    const err = await failure(getEntries());
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/signed out/);
    expect(expired).toHaveBeenCalledOnce();
  });

  it("does not treat a wrong PIN (401 from /auth/*) as an expired session", async () => {
    setToken("old");
    const expired = expiredHandler();
    answer(json(401, { error: "Wrong username or PIN" }));
    const err = await failure(login("someone", "0000"));
    expect(err.status).toBe(401);
    expect(err.message).toBe("Wrong username or PIN");
    expect(expired).not.toHaveBeenCalled();
  });

  it("does not sign out on a 401 when there was no token to expire", async () => {
    const expired = expiredHandler();
    answer(json(401, { error: "No token" }));
    await failure(getEntries());
    expect(expired).not.toHaveBeenCalled();
  });

  it("keeps the session on a server error and passes on its message", async () => {
    setToken("t");
    const expired = expiredHandler();
    answer(json(500, { error: "Failed to load entries" }));
    const err = await failure(getEntries());
    expect(err.status).toBe(500);
    expect(err.message).toBe("Failed to load entries");
    expect(expired).not.toHaveBeenCalled();
    expect(getToken()).toBe("t");
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    setToken("t");
    answer(new Response("Bad gateway", { status: 502 }));
    expect((await failure(getEntries())).message).toBe("Request failed (502)");
  });

  it("returns the free-limit answer (402) instead of throwing", async () => {
    setToken("t");
    answer(json(402, { error: "free_limit_reached" }));
    await expect(sendChat("hi", "session-1")).resolves.toEqual({ error: "free_limit_reached" });
  });
});

describe("authFetch: requests", () => {
  it("sends the token as a bearer header", async () => {
    setToken("abc");
    const fetchMock = answer(json(200, []));
    await getEntries();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer abc");
  });

  it("sends no Authorization header when signed out", async () => {
    const fetchMock = answer(json(200, []));
    await getEntries();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty("Authorization");
  });

  it("remembers the token and the name after signing in", async () => {
    answer(json(200, { token: "new-token", pin_length: 4 }));
    await login("reader", "1234");
    expect(getToken()).toBe("new-token");
    expect(storageGet("arc_username")).toBe("reader");
  });
});

describe("safe storage", () => {
  it("reads nothing, and drops writes, when storage throws", () => {
    const boom = () => { throw new Error("SecurityError"); };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    expect(storageGet("k")).toBeNull();
    expect(() => storageSet("k", "v")).not.toThrow();
    expect(() => storageRemove("k")).not.toThrow();
  });
});
