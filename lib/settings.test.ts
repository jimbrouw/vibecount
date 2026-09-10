import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PDF_ACCENT_COLOR,
  DEFAULT_PDF_PRIMARY_COLOR,
  sanitizeUserSettings,
} from "./settings.ts";
import { MAX_PDF_LOGO_BYTES, validatePdfLogoUpload } from "./settings-logo.ts";

test("saves valid PDF branding hex colours", () => {
  const settings = sanitizeUserSettings({
    pdf_primary_color: "#0055AA",
    pdf_accent_color: "#ffeecc",
  });

  assert.ok(settings);
  assert.equal(settings.pdf_primary_color, "#0055aa");
  assert.equal(settings.pdf_accent_color, "#ffeecc");
});

test("falls back when PDF branding colours are invalid", () => {
  const settings = sanitizeUserSettings({
    pdf_primary_color: "0055aa",
    pdf_accent_color: "rgb(255, 238, 204)",
  });

  assert.ok(settings);
  assert.equal(settings.pdf_primary_color, DEFAULT_PDF_PRIMARY_COLOR);
  assert.equal(settings.pdf_accent_color, DEFAULT_PDF_ACCENT_COLOR);
});

test("does not persist temporary logo URLs as PDF logo paths", () => {
  const settings = sanitizeUserSettings({
    pdf_logo_url: "https://example.com/signed-url",
  });

  assert.ok(settings);
  assert.equal(settings.pdf_logo_path, "");
  assert.equal("pdf_logo_url" in settings, false);
});

test("accepts only PNG and JPG logo uploads within 2MB", () => {
  assert.deepEqual(validatePdfLogoUpload("image/png", MAX_PDF_LOGO_BYTES), {
    ok: true,
    ext: "png",
  });
  assert.deepEqual(validatePdfLogoUpload("image/jpeg", 1024), {
    ok: true,
    ext: "jpg",
  });
  assert.deepEqual(validatePdfLogoUpload("application/pdf", 1024), {
    ok: false,
    error: "Logo must be a PNG or JPG image.",
  });
  assert.deepEqual(validatePdfLogoUpload("image/png", MAX_PDF_LOGO_BYTES + 1), {
    ok: false,
    error: "Logo must be 2MB or smaller.",
  });
});
