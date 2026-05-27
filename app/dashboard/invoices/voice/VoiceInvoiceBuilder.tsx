"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { amountToWords, formatPounds } from "@/lib/invoices/money";
import { trackEvent } from "@/lib/analytics";
import PlainLanguageNote from "@/app/dashboard/PlainLanguageNote";
import type { VoiceDraft } from "@/lib/voice/extraction";

type DraftResponse = {
  transcript: string;
  draft: VoiceDraft;
};

export default function VoiceInvoiceBuilder() {
  const router = useRouter();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [hasPlayedReadback, setHasPlayedReadback] = useState(false);

  const resolvedAmount = useMemo(() => {
    if (!draft) {
      return null;
    }

    if (draft.amount_ambiguous) {
      return selectedAmount;
    }

    return draft.amount;
  }, [draft, selectedAmount]);

  const resolvedAmountPence = resolvedAmount === null ? null : Math.round(resolvedAmount * 100);
  const readbackText = useMemo(() => {
    if (!draft || resolvedAmountPence === null) {
      return "";
    }

    return `Please confirm this voice draft. Client ${draft.client}. Description ${draft.description}. Amount ${formatPounds(
      resolvedAmountPence
    )}. In words, ${amountToWords(resolvedAmountPence)}.`;
  }, [draft, resolvedAmountPence]);

  async function startRecording() {
    setError("");
    setDraft(null);
    setHasPlayedReadback(false);

    try {
      trackEvent("voice_invoice_attempt", { input: "microphone" });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        await submitVoiceDraft({ audioBlob: blob });
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      trackEvent("failed_voice_attempt", {
        stage: "microphone_access",
        reason: "blocked_or_unavailable",
      });
      setError("Microphone access was blocked. You can paste or edit a transcript below instead.");
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) {
      return;
    }

    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }

  async function submitVoiceDraft({
    audioBlob,
    transcriptOverride,
  }: {
    audioBlob?: Blob;
    transcriptOverride?: string;
  }) {
    setIsSubmitting(true);
    setError("");
    setDraft(null);
    setSelectedAmount(null);
    setHasPlayedReadback(false);

    trackEvent("voice_invoice_attempt", {
      input: audioBlob ? "audio_blob" : "transcript",
    });

    const formData = new FormData();
    if (audioBlob) {
      formData.append("audio", audioBlob, "voice.webm");
    }
    if (transcriptOverride?.trim()) {
      formData.append("transcript", transcriptOverride.trim());
    }

    const response = await fetch("/api/voice/draft", {
      method: "POST",
      body: formData,
    });

    const body = (await response.json().catch(() => null)) as
      | DraftResponse
      | { error?: string }
      | null;

    if (!response.ok || !body || !("draft" in body)) {
      trackEvent("failed_voice_attempt", {
        stage: "draft_extraction",
        reason: body && "error" in body && body.error ? body.error : "unknown_error",
      });
      setError(body && "error" in body && body.error ? body.error : "Could not create a voice draft.");
      setIsSubmitting(false);
      return;
    }

    trackEvent("invoice_draft_completion", {
      source: audioBlob ? "voice" : "transcript",
      amount_ambiguous: body.draft.amount_ambiguous,
    });
    setTranscript(body.transcript);
    setDraft(body.draft);
    if (!body.draft.amount_ambiguous) {
      setSelectedAmount(body.draft.amount);
    }
    setIsSubmitting(false);
  }

  function playReadback() {
    if (!readbackText || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(readbackText);
    utterance.lang = "en-GB";
    utterance.rate = 0.95;
    utterance.onend = () => setHasPlayedReadback(true);
    utterance.onerror = () => setHasPlayedReadback(false);
    setHasPlayedReadback(false);
    window.speechSynthesis.speak(utterance);
  }

  function continueToTypedPreview() {
    if (!draft || resolvedAmount === null || !hasPlayedReadback) {
      return;
    }

    const params = new URLSearchParams({
      clientName: draft.client,
      description: draft.description,
      amount: resolvedAmount.toFixed(2),
      transcript,
      source: "voice",
    });
    router.push(`/dashboard/invoices/new?${params.toString()}`);
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#e5e0d8] sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[#1a3a2a]">
            Speak an invoice
          </h1>
          <p className="mt-1 text-sm leading-6 text-[#4a6a5a]">
            Record a short invoice sentence, then confirm the extracted amount before
            moving to the standard preview screen.
          </p>
          <div className="mt-3">
            <PlainLanguageNote>
              Say who the invoice is for, what the work was, and the amount. If the
              amount could mean two different things, you must choose the right one.
            </PlainLanguageNote>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border border-[#d7d1c3] bg-[#f6f2ea] p-4">
            <p className="text-sm font-medium text-[#1a3a2a]">Voice capture</p>
            <p className="mt-1 text-sm text-[#4a6a5a]">
              Example: “Invoice Simon eight hundred and fifty pounds for projection mapping.”
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={isSubmitting}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-[#1a3a2a] px-5 text-sm font-semibold text-white transition hover:bg-[#2d6a4a] disabled:cursor-not-allowed disabled:bg-[#8a9a91]"
                >
                  {isSubmitting ? "Working..." : "Start recording"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-[#7a271a] px-5 text-sm font-semibold text-white transition hover:bg-[#923728]"
                >
                  Stop and transcribe
                </button>
              )}

              <Link
                href="/dashboard/invoices/new"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-[#d5d0c8] bg-white px-5 text-sm font-semibold text-[#1a3a2a] transition hover:bg-[#f8f5ef]"
              >
                Use typing instead
              </Link>
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-[#1a3a2a]">
              Transcript
            </span>
            <textarea
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              rows={4}
              placeholder="If needed, paste or correct the transcript here, then extract again."
              className="mt-2 w-full resize-y rounded-xl border border-[#d5d0c8] bg-white px-3 py-3 text-base leading-6 text-[#1a3a2a] outline-none transition focus:border-[#2d6a4a] focus:ring-2 focus:ring-[#b9d2bd]"
            />
          </label>

          <button
            type="button"
            onClick={() => submitVoiceDraft({ transcriptOverride: transcript })}
            disabled={isSubmitting || transcript.trim() === ""}
            className="inline-flex h-12 items-center justify-center rounded-xl border border-[#d5d0c8] bg-white px-5 text-sm font-semibold text-[#1a3a2a] transition hover:bg-[#f8f5ef] disabled:cursor-not-allowed disabled:text-[#8a9a91]"
          >
            Re-extract from transcript
          </button>

          {error ? (
            <p className="rounded-lg border border-[#e0b4a7] bg-[#fff7f3] px-4 py-3 text-sm text-[#7a271a]">
              {error}
            </p>
          ) : null}

          {draft ? (
            <div className="rounded-xl border border-[#d5d0c8] bg-[#f8f5ef] p-4">
              <p className="text-sm font-medium text-[#1a3a2a]">Voice draft</p>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                    Client
                  </p>
                  <p className="mt-1 text-sm text-[#1a3a2a]">{draft.client || "Not found"}</p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                    Work
                  </p>
                  <p className="mt-1 text-sm text-[#1a3a2a]">
                    {draft.description || "Not found"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                    Amount
                  </p>
                  {draft.amount_ambiguous ? (
                    <div className="mt-2 rounded-lg border border-[#e5c98b] bg-[#fff8e8] p-4">
                      <p className="text-sm font-medium text-[#7a5a1c]">
                        This amount is ambiguous. Choose the right reading before you continue.
                      </p>
                      <div className="mt-3 space-y-2">
                        {draft.amount_candidates.map((candidate) => {
                          const candidatePence = Math.round(candidate * 100);
                          return (
                            <label
                              key={candidate}
                              className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#e5e0d8] bg-white px-3 py-3"
                            >
                              <input
                                type="radio"
                                name="voice-amount"
                                checked={selectedAmount === candidate}
                                onChange={() => setSelectedAmount(candidate)}
                                className="mt-1"
                              />
                              <span>
                                <span className="block text-sm font-medium text-[#1a3a2a]">
                                  {formatPounds(candidatePence)}
                                </span>
                                <span className="block text-xs text-[#4a6a5a]">
                                  {amountToWords(candidatePence)}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : resolvedAmountPence !== null ? (
                    <div className="mt-2 rounded-lg border border-[#d5d0c8] bg-white px-4 py-3">
                      <p className="text-base font-semibold text-[#1a3a2a]">
                        {formatPounds(resolvedAmountPence)}
                      </p>
                      <p className="mt-1 text-sm text-[#4a6a5a]">
                        {amountToWords(resolvedAmountPence)}
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-[#c8dfc8] bg-[#f0f8f0] p-4">
                  <p className="text-sm font-medium text-[#1a3a2a]">
                    Mandatory read-back
                  </p>
                  <p className="mt-1 text-sm text-[#4a6a5a]">
                    Play the spoken amount summary, listen to it, then continue to the
                    normal invoice preview.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={playReadback}
                      disabled={!readbackText}
                      className="inline-flex h-11 items-center justify-center rounded-xl bg-[#1a3a2a] px-4 text-sm font-semibold text-white transition hover:bg-[#2d6a4a] disabled:cursor-not-allowed disabled:bg-[#8a9a91]"
                    >
                      Play read-back
                    </button>
                    <span className="text-xs text-[#4a6a5a]">
                      {hasPlayedReadback
                        ? "Read-back completed."
                        : "You must play the spoken read-back before continuing."}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={continueToTypedPreview}
                  disabled={!draft || resolvedAmount === null || !hasPlayedReadback}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-[#1a3a2a] px-5 text-sm font-semibold text-white transition hover:bg-[#2d6a4a] disabled:cursor-not-allowed disabled:bg-[#8a9a91]"
                >
                  Continue to invoice preview
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <aside className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#e5e0d8] sm:p-6 lg:sticky lg:top-6 lg:self-start">
        <p className="text-sm font-medium uppercase tracking-[0.12em] text-[#4a6a5a]">
          Voice rules
        </p>
        <div className="mt-5 space-y-4 text-sm leading-6 text-[#1a3a2a]">
          <p>The amount is never auto-trusted.</p>
          <p>If the wording could mean two numbers, you must choose the right one.</p>
          <p>The spoken read-back is required before the app lets you continue.</p>
          <p>The final invoice still lands in the normal editable preview before PDF download.</p>
        </div>
      </aside>
    </div>
  );
}
