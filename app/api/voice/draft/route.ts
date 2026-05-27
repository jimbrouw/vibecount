import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  EXTRACTION_MODEL,
  parseVoiceDraft,
  SYSTEM_PROMPT,
} from "@/lib/voice/extraction";

export const runtime = "nodejs";

const TRANSCRIPTION_MODEL = process.env.VIBECOUNT_TRANSCRIPTION_MODEL || "whisper-1";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to create a voice draft." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const transcriptInput = String(formData.get("transcript") ?? "").trim();
  const audioFile = formData.get("audio");

  let transcript = transcriptInput;
  if (!transcript) {
    if (!(audioFile instanceof File)) {
      return NextResponse.json(
        { error: "Provide either a transcript or an audio recording." },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing. Add it before using voice capture." },
        { status: 503 }
      );
    }

    const transcribed = await transcribeAudio(audioFile);
    if (!transcribed) {
      return NextResponse.json({ error: "Could not transcribe the recording." }, { status: 502 });
    }
    transcript = transcribed;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is missing. Add it before extracting voice drafts." },
      { status: 503 }
    );
  }

  const extractionText = await extractDraft(transcript);
  const draft = extractionText ? parseVoiceDraft(extractionText) : null;

  if (!draft) {
    return NextResponse.json(
      { error: "Could not turn the transcript into a draft invoice." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    transcript,
    draft,
  });
}

async function transcribeAudio(file: File) {
  const formData = new FormData();
  formData.append("file", file, file.name || "voice.webm");
  formData.append("model", TRANSCRIPTION_MODEL);
  formData.append("response_format", "json");
  formData.append("language", "en");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json().catch(() => null)) as { text?: string } | null;
  return body?.text?.trim() || null;
}

async function extractDraft(transcript: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
    },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: transcript }],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json().catch(() => null)) as
    | { content?: Array<{ type?: string; text?: string }> }
    | null;

  return (
    body?.content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("") || null
  );
}
