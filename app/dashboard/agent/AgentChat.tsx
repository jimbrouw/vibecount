"use client";

import { FormEvent, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant" | "error";
  content: string;
};

const STARTER_PROMPTS = [
  "Summarise my income this tax year",
  "What is Self Assessment and when is it due?",
  "List my recent invoices",
  "What expenses can I claim as a sole trader?",
];

export default function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages
            .filter((m) => m.role !== "error")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setMessages((prev) => [
          ...prev,
          { role: "error", content: data.error ?? "Something went wrong." },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.content },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "error", content: "Could not reach the agent. Please try again." },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        inputRef.current?.focus();
      }, 50);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-xl">
            <p className="mb-6 text-sm text-[#4b8068]">
              Ask about your invoices, UK taxes, or anything about running your
              freelance business. Your data stays in VibeCount — the agent reads
              it on your behalf.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="rounded-xl border border-[#bbf7d0] bg-white px-4 py-3 text-left text-sm text-[#14532d] transition hover:border-[#86efac] hover:shadow-sm"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "error" ? (
                  <div className="max-w-prose rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {msg.content}
                  </div>
                ) : msg.role === "user" ? (
                  <div className="max-w-prose rounded-2xl bg-[#15803d] px-4 py-3 text-sm text-white">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-prose rounded-2xl border border-[#bbf7d0] bg-white px-4 py-3 text-sm text-[#14532d] shadow-sm">
                    <Formatted text={msg.content} />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[#bbf7d0] bg-white px-4 py-3 shadow-sm">
                  <span className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[#86efac] [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[#86efac] [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[#86efac] [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-[#bbf7d0] bg-white px-5 py-4 sm:px-8">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about taxes, invoices, or your finances…"
            rows={1}
            disabled={loading}
            className="flex-1 resize-none rounded-xl border border-[#bbf7d0] px-4 py-3 text-sm text-[#14532d] placeholder-[#86a88e] outline-none transition focus:border-[#15803d] focus:ring-2 focus:ring-[#15803d]/20 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#15803d] text-white transition hover:bg-[#14532d] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 8l12-6-5 6 5 6z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-[#86a88e]">
          AI can make mistakes. Always verify tax figures with a qualified accountant.
        </p>
      </div>
    </div>
  );
}

// Renders newlines and basic markdown bold (**text**)
function Formatted({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return part.split("\n").map((line, j) => (
          <span key={`${i}-${j}`}>
            {line}
            {j < part.split("\n").length - 1 && <br />}
          </span>
        ));
      })}
    </>
  );
}
