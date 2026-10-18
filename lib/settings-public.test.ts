import assert from "node:assert/strict";
import test from "node:test";
import { invoiceDefaults, publicSettings, settingsWrite } from "./settings-public.ts";

const privateRow = {
  legal_name: "Example Studio", companies_house_api_key: "private-test-credential",
  utr: "1234567890", internal_future_secret: "must-not-escape",
};

test("settings read and save responses never echo credentials or unknown database columns", () => {
  const output = publicSettings(privateRow);
  assert.equal(output.companies_house_configured, true);
  assert.equal(output.companies_house_api_key, "");
  assert.equal(output.legal_name, "Example Studio");
  assert.ok(!JSON.stringify(output).includes("private-test-credential"));
  assert.equal("internal_future_secret" in output, false);
});

test("invoice defaults contain only invoice fields, excluding UTR and API credentials", () => {
  const output = invoiceDefaults(privateRow);
  assert.equal(output.companiesHouseConfigured, true);
  assert.equal(output.hasSettings, true);
  assert.equal("utr" in output, false);
  assert.equal("companies_house_api_key" in output, false);
  assert.equal("internal_future_secret" in output, false);
});

test("saving unrelated settings preserves credential, replacement and explicit removal work", () => {
  assert.equal("companies_house_api_key" in settingsWrite({ legal_name: "Updated", companies_house_api_key: "" })!, false);
  assert.equal(settingsWrite({ companies_house_api_key: " replacement " })?.companies_house_api_key, "replacement");
  assert.equal(settingsWrite({ remove_companies_house_key: true })?.companies_house_api_key, "");
  assert.equal(settingsWrite(null), null);
});
