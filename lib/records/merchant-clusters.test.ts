import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanMerchantName,
  getMerchantSuggestion,
  clusterSourceTransactions,
  type ClusterableTransaction,
} from "./merchant-clusters.ts";

test("cleanMerchantName cleans noisy bank descriptions", () => {
  assert.equal(cleanMerchantName("TFL.GOV.UK/CP AUTO 1234"), "TfL Travel");
  assert.equal(cleanMerchantName("TFL TRAVEL CH MAY25"), "TfL Travel");
  assert.equal(cleanMerchantName("ADOBE *SYSTEMS IRELAND"), "Adobe");
  assert.equal(cleanMerchantName("GITHUB *PRO SUBSCRIPTION"), "GitHub");
  assert.equal(cleanMerchantName("TESCO STORES 4821 CD 9012"), "Tesco");
  assert.equal(cleanMerchantName("SAINSBURYS S/MKTS LONDON"), "Sainsbury's");
  assert.equal(cleanMerchantName("PRET A MANGER REGENT ST"), "Pret A Manger");
  assert.equal(cleanMerchantName("TRAINLINE.COM 4981"), "Trainline");
});

test("getMerchantSuggestion returns appropriate defaults", () => {
  assert.deepEqual(getMerchantSuggestion("Adobe", "expense"), {
    classification: "Business",
    categoryName: "Software & Subscriptions",
  });
  assert.deepEqual(getMerchantSuggestion("TfL Travel", "expense"), {
    classification: "Business",
    categoryName: "Travel & Transport",
  });
  assert.deepEqual(getMerchantSuggestion("Tesco", "expense"), {
    classification: "Personal",
    categoryName: null,
  });
  assert.deepEqual(getMerchantSuggestion("Client Project Deposit", "income"), {
    classification: "Business",
    categoryName: "Sales / Turnover",
  });
});

test("clusterSourceTransactions groups rows and sorts multi-item clusters first", () => {
  const transactions: ClusterableTransaction[] = [
    {
      id: "tx-1",
      decision_version: 1,
      transaction_date: "2025-06-10",
      signed_amount_pence: -280,
      description: "TFL.GOV.UK/CP",
      reference: "",
      classification: "Unknown",
      dedupe_status: "clear",
    },
    {
      id: "tx-2",
      decision_version: 1,
      transaction_date: "2025-06-15",
      signed_amount_pence: -340,
      description: "TFL TRAVEL CH",
      reference: "",
      classification: "Unknown",
      dedupe_status: "clear",
    },
    {
      id: "tx-3",
      decision_version: 1,
      transaction_date: "2025-07-01",
      signed_amount_pence: -1999,
      description: "ADOBE *CREATIVE CLOUD",
      reference: "",
      classification: "Unknown",
      dedupe_status: "clear",
    },
    {
      id: "tx-4",
      decision_version: 1,
      transaction_date: "2025-07-02",
      signed_amount_pence: -450,
      description: "RANDOM ONE-OFF CAFE",
      reference: "",
      classification: "Unknown",
      dedupe_status: "clear",
    },
  ];

  const clusters = clusterSourceTransactions(transactions);

  // TfL has 2 transactions, so it should be the first cluster
  assert.equal(clusters.length, 3);
  assert.equal(clusters[0].name, "TfL Travel");
  assert.equal(clusters[0].count, 2);
  assert.equal(clusters[0].totalPence, 620); // 280 + 340
  assert.equal(clusters[0].earliestDate, "2025-06-10");
  assert.equal(clusters[0].latestDate, "2025-06-15");
  assert.equal(clusters[0].suggestedClassification, "Business");
  assert.equal(clusters[0].suggestedCategoryName, "Travel & Transport");

  // Adobe and Random One-off have 1 transaction each; Adobe has higher totalPence so it comes before Random
  assert.equal(clusters[1].name, "Adobe");
  assert.equal(clusters[1].totalPence, 1999);

  assert.equal(clusters[2].name, "Random One-off Cafe");
  assert.equal(clusters[2].totalPence, 450);
});
