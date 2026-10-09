import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { appendTranscript, splitResults, useSpeechToText, VOICE_MESSAGES, type ResultEvent } from "./speech";

describe("appendTranscript", () => {
  it("appends to typed text with a single space and never replaces it", () => {
    expect(appendTranscript("The printer", "is offline")).toBe("The printer is offline");
    expect(appendTranscript("Line one\n", "line two")).toBe("Line one\nline two");
    expect(appendTranscript("", "  hello   world ")).toBe("hello world");
    expect(appendTranscript("keep me", "   ")).toBe("keep me");
  });
});

function ev(resultIndex: number, results: [string, boolean][]): ResultEvent {
  const list = results.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal }));
  return { resultIndex, results: Object.assign(list, { length: list.length }) } as unknown as ResultEvent;
}

describe("splitResults", () => {
  it("separates final from interim and only reads results from resultIndex", () => {
    expect(splitResults(ev(0, [["hello there", false]]))).toEqual({ final: "", interim: "hello there" });
    // Second event: result 0 became final, result 1 interim. Earlier finals are not re-read.
    expect(splitResults(ev(0, [["hello there", true], [" how", false]]))).toEqual({ final: "hello there", interim: "how" });
    expect(splitResults(ev(1, [["hello there", true], [" how are you", true]]))).toEqual({ final: "how are you", interim: "" });
  });
});

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: ResultEvent) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

function useForm() {
  const [text, setText] = useState("Typed first.");
  const voice = useSpeechToText((t) => setText((c) => appendTranscript(c, t)));
  return { text, setText, voice };
}

describe("useSpeechToText", () => {
  it("configures en-IN continuous interim recognition and commits each final phrase exactly once", () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    const { result } = renderHook(() => useForm());
    act(() => result.current.voice.start());
    const rec = FakeRecognition.last!;
    expect(rec.lang).toBe("en-IN");
    expect(rec.continuous && rec.interimResults).toBe(true);
    expect(result.current.voice.listening).toBe(true);

    act(() => rec.onresult!(ev(0, [["the screen", false]])));
    expect(result.current.text).toBe("Typed first."); // interim never touches the field
    expect(result.current.voice.interim).toBe("the screen");
    act(() => rec.onresult!(ev(0, [["the screen is blank", true]])));
    act(() => rec.onresult!(ev(1, [["the screen is blank", true], ["after update", true]])));
    expect(result.current.text).toBe("Typed first. the screen is blank after update");

    act(() => result.current.voice.stop());
    expect(result.current.voice.listening).toBe(false);
  });

  it("keeps typed text and shows the exact denied message on permission errors", () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    const { result } = renderHook(() => useForm());
    act(() => result.current.voice.start());
    act(() => {
      FakeRecognition.last!.onerror!({ error: "not-allowed" });
      FakeRecognition.last!.onend!();
    });
    expect(result.current.voice.error).toBe(VOICE_MESSAGES.denied);
    expect(VOICE_MESSAGES.denied).toBe(
      "Microphone access was denied. Please allow microphone access in your browser settings to use voice input."
    );
    expect(result.current.voice.listening).toBe(false);
    expect(result.current.text).toBe("Typed first.");
  });

  it("reports unsupported browsers with the exact message", () => {
    const { result } = renderHook(() => useForm());
    expect(result.current.voice.supported).toBe(false);
    act(() => result.current.voice.start());
    expect(result.current.voice.error).toBe("Voice input isn't supported by this browser. You can continue typing normally.");
    expect(result.current.text).toBe("Typed first.");
  });
});
