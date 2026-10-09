"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice input for free-text fields via the browser's built-in Web Speech API
 * (SpeechRecognition / webkitSpeechRecognition). No paid service and no audio
 * upload or storage by this app: only the recognized text is used. (Some
 * browsers, e.g. Chrome, perform recognition on the vendor's servers - that
 * is the browser's own feature, not an integration of ours.)
 */

export const VOICE_MESSAGES = {
  denied: "Microphone access was denied. Please allow microphone access in your browser settings to use voice input.",
  unsupported: "Voice input isn't supported by this browser. You can continue typing normally.",
  failed: "Voice input stopped unexpectedly. Your text is safe - press the mic to try again.",
  noSpeech: "No speech was detected. Press the mic to try again.",
} as const;

export const DEFAULT_SPEECH_LANG = "en-IN";

/** Append recognized text to what is already typed, never replacing it. */
export function appendTranscript(current: string, transcript: string): string {
  const addition = transcript.replace(/\s+/g, " ").trim();
  if (!addition) return current;
  if (!current) return addition;
  return /\s$/.test(current) ? current + addition : `${current} ${addition}`;
}

type Alternative = { transcript: string };
type Result = { isFinal: boolean; length: number; [index: number]: Alternative };
export type ResultEvent = { resultIndex: number; results: { length: number; [index: number]: Result } };

/**
 * Split one recognition event into newly FINAL text (to commit) and the
 * current interim text (preview only). Only results from resultIndex on are
 * new, so a final phrase is committed exactly once - no duplicated words.
 */
export function splitResults(event: ResultEvent): { final: string; interim: string } {
  let final = "";
  let interim = "";
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    const text = result?.[0]?.transcript ?? "";
    if (result?.isFinal) final += text;
    else interim += text;
  }
  return { final: final.trim(), interim: interim.trim() };
}

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Start/stop dictation. `onFinal` receives each finalized phrase once; the
 * caller appends it to its own state (appendTranscript), so typed text is
 * never overwritten and the caret is not moved by interim results.
 */
export function useSpeechToText(onFinal: (text: string) => void, lang: string = DEFAULT_SPEECH_LANG) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const recognition = useRef<Recognition | null>(null);
  const finalHandler = useRef(onFinal);
  finalHandler.current = onFinal;

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => recognition.current?.abort();
  }, []);

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      setError(VOICE_MESSAGES.unsupported);
      return;
    }
    recognition.current?.abort();
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      const { final, interim: preview } = splitResults(event);
      if (final) finalHandler.current(final);
      setInterim(preview);
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setError(VOICE_MESSAGES.denied);
      else if (event.error === "no-speech") setError(VOICE_MESSAGES.noSpeech);
      else if (event.error !== "aborted") setError(VOICE_MESSAGES.failed);
    };
    rec.onend = () => {
      // Recognition ended (stop, error, timeout or disconnect). Committed
      // text is already in the field; just drop the preview.
      setListening(false);
      setInterim("");
      if (recognition.current === rec) recognition.current = null;
    };
    recognition.current = rec;
    setError(null);
    setInterim("");
    try {
      rec.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setListening(false);
      setError(VOICE_MESSAGES.failed);
    }
  }, [lang]);

  return { supported, listening, interim, error, start, stop };
}
