import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

type FetchMock = ReturnType<typeof vi.fn>;

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  } as Response;
}

function installFetch(...responses: Response[]): FetchMock {
  const mock = vi.fn();
  for (const item of responses) {
    mock.mockResolvedValueOnce(item);
  }
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("local API client", () => {
  it("reads the overview from the relative API root", async () => {
    const mock = installFetch(response({ place_count: 2 }));
    await expect(api.overview()).resolves.toEqual({ place_count: 2 });

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/overview");
    expect(init.headers).toMatchObject({ Accept: "application/json" });
  });

  it("surfaces the first FastAPI validation message", async () => {
    installFetch(
      response(
        {
          detail: [
            { loc: ["body", "name"], msg: "Value error, Name cannot be blank" },
            { loc: ["body", "description"], msg: "Too long" },
          ],
        },
        422,
      ),
    );

    await expect(api.createPlace("", "")).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      detail: "Name cannot be blank",
    });
  });

  it("surfaces server detail strings and raw text", async () => {
    installFetch(response({ detail: "This place does not exist." }, 404));
    await expect(api.place(99)).rejects.toEqual(
      expect.objectContaining({
        status: 404,
        detail: "This place does not exist.",
      }),
    );

    installFetch(response("plain failure", 500));
    await expect(api.places()).rejects.toMatchObject({
      status: 500,
      detail: "plain failure",
    });
  });

  it("gives a specific message when the local server is unreachable", async () => {
    const mock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", mock);

    const error = await api.health().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).detail).toContain(
      "Hush Atlas server is not reachable",
    );
  });

  it("uploads multipart audio without forcing a JSON content type", async () => {
    const mock = installFetch(
      response({ id: 12, title: "Evening rain", place_id: 1 }, 201),
    );
    const file = new File(["RIFF"], "evening.wav", { type: "audio/wav" });

    await api.uploadRecording(1, {
      file,
      title: "Evening rain",
      notes: "Light rain",
      recordedAt: "2026-04-09T18:00:00.000Z",
      source: "upload",
    });

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/places/1/recordings");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("title")).toBe("Evening rain");
    expect(form.get("notes")).toBe("Light rain");
    expect(form.get("recorded_at")).toBe("2026-04-09T18:00:00.000Z");
    expect(form.get("source")).toBe("upload");
    expect(form.get("file")).toBeInstanceOf(File);
    expect(init.headers).not.toHaveProperty("Content-Type");
  });

  it("persists a Gemma model selection with a JSON body", async () => {
    const mock = installFetch(response({ selected_model: "gemma3:4b" }));
    await api.selectGemma("gemma3:4b");

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/models/gemma");
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ model: "gemma3:4b" });
  });

  it("encodes place and recording identifiers in normal requests", async () => {
    const mock = installFetch(response([]), response({ id: 7 }));
    await api.comparisons(4);
    await api.recording(7);

    expect(mock.mock.calls[0]?.[0]).toBe("/api/comparisons?place_id=4");
    expect(mock.mock.calls[1]?.[0]).toBe("/api/recordings/7");
  });
});
