"use client";

import { useRef, useState, useEffect } from "react";

export default function SignatureCanvas({ contractId, contractNumber }: { contractId: string; contractNumber: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!open || mode !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#14532d";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [open, mode]);

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    drawing.current = true;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function endDraw() {
    drawing.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function buildTypedSignaturePng(): string {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 120;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 400, 120);
    ctx.fillStyle = "#14532d";
    ctx.font = "italic 48px Georgia, serif";
    ctx.textBaseline = "middle";
    ctx.fillText(typedName, 16, 60);
    return canvas.toDataURL("image/png");
  }

  async function handleSign() {
    let dataUrl: string;

    if (mode === "draw") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      dataUrl = canvas.toDataURL("image/png");
    } else {
      if (!typedName.trim()) return;
      dataUrl = buildTypedSignaturePng();
    }

    setState("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/contracts/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, signatureDataUrl: dataUrl }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setErrorMsg(data.error ?? "Signing failed. Try again.");
        setState("error");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${contractNumber}-signed.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setState("done");
    } catch {
      setErrorMsg("Could not reach the signing service.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-lg border border-[#86efac] bg-[#dcfce7] px-4 py-3 text-sm font-medium text-[#14532d]" data-testid={`contract-signed-${contractId}`}>
        Signed — your PDF downloaded automatically. Contract marked as signed.
      </div>
    );
  }

  return (
    <div data-testid={`signature-section-${contractId}`}>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid={`open-sign-button-${contractId}`}
          className="inline-flex h-9 items-center rounded-lg bg-[#14532d] px-4 text-xs font-semibold text-white transition hover:bg-[#0f3d21]"
        >
          Sign contract
        </button>
      ) : (
        <div className="rounded-xl border border-[#bbf7d0] bg-white p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Your signature</p>
          <p className="text-xs text-[#854d0e]">
            By signing you confirm this is your simple electronic signature, valid under the Electronic Communications Act 2000.
          </p>

          <div className="flex gap-2">
            <button type="button" onClick={() => setMode("draw")} className={`text-xs font-semibold px-3 py-1 rounded-lg border transition ${mode === "draw" ? "bg-[#15803d] text-white border-[#15803d]" : "bg-white text-[#14532d] border-[#bbf7d0] hover:bg-[#f0fdf4]"}`}>Draw</button>
            <button type="button" onClick={() => setMode("type")} className={`text-xs font-semibold px-3 py-1 rounded-lg border transition ${mode === "type" ? "bg-[#15803d] text-white border-[#15803d]" : "bg-white text-[#14532d] border-[#bbf7d0] hover:bg-[#f0fdf4]"}`}>Type name</button>
          </div>

          {mode === "draw" ? (
            <div>
              <canvas
                ref={canvasRef}
                width={600}
                height={160}
                data-testid={`signature-canvas-${contractId}`}
                className="w-full rounded-lg border border-[#bbf7d0] bg-white touch-none cursor-crosshair"
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
              />
              <button type="button" onClick={clearCanvas} className="mt-1 text-xs text-[#4b8068] underline">Clear</button>
            </div>
          ) : (
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your full name"
              data-testid={`signature-type-input-${contractId}`}
              className="h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm italic text-[#14532d] outline-none focus:border-[#15803d]"
              style={{ fontFamily: "Georgia, serif" }}
            />
          )}

          {state === "error" && (
            <p className="text-xs text-[#7a271a]">{errorMsg}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSign}
              disabled={state === "submitting" || (mode === "type" && !typedName.trim())}
              data-testid={`confirm-sign-button-${contractId}`}
              className="inline-flex h-9 items-center rounded-lg bg-[#15803d] px-4 text-xs font-semibold text-white transition hover:bg-[#14532d] disabled:opacity-50"
            >
              {state === "submitting" ? "Signing…" : "Confirm & download signed PDF"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setState("idle"); }} className="text-xs text-[#4b8068] underline">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
