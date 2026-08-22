// Why: eval questions are derived from the Aurora Notebook handbook fixture.
// A retrieved chunk counts as "relevant" if it contains ANY of the expected
// substrings — that's more robust than pinning to chunk IDs (which change on
// re-ingest) or to exact strings (which fail on whitespace differences).
//
// Substrings are case-insensitive and whitespace-normalized before comparison.
// See `metrics.ts::chunkMatches`.

export type EvalQuestion = {
  id: string;
  question: string;
  // Any of these substrings appearing in a retrieved chunk marks it as a hit.
  expectedSubstrings: string[];
  // Optional lens tag for reporting (pricing / warranty / troubleshooting / etc).
  category?: string;
};

export const AURORA_QUESTIONS: EvalQuestion[] = [
  {
    id: "q1-pro-price",
    category: "pricing",
    question: "What is the price of the Aurora Notebook Pro?",
    expectedSubstrings: ["$2,899", "ANP-C3"],
  },
  {
    id: "q2-warranty-length",
    category: "warranty",
    question: "How long is the warranty?",
    expectedSubstrings: ["one-year limited warranty", "one-year"],
  },
  {
    id: "q3-battery-cycles",
    category: "battery",
    question: "How many charge cycles does the battery last?",
    expectedSubstrings: ["1,000 full charge cycles", "80% of original capacity"],
  },
  {
    id: "q4-phone-support",
    category: "support",
    question: "What's the phone number for phone support?",
    expectedSubstrings: ["1-800-287-6721", "1-800-AURORA-1"],
  },
  {
    id: "q5-13-model-code",
    category: "specs",
    question: "What's the model code for the 13 inch Aurora Notebook?",
    expectedSubstrings: ["AN13-A1"],
  },
  {
    id: "q6-15-ram",
    category: "specs",
    question: "How much RAM does the Aurora Notebook 15 have?",
    expectedSubstrings: ["32 GB RAM", "AN15-B2"],
  },
  {
    id: "q7-recycling",
    category: "recycling",
    question: "How do I recycle my old Aurora device?",
    expectedSubstrings: ["Aurora Care Center", "recycle.aurora-notebook.example"],
  },
  {
    id: "q8-firmware-trackpad",
    category: "troubleshooting",
    question: "The trackpad is unresponsive after a firmware update — what should I do?",
    expectedSubstrings: ["2.4.0 firmware", "Rolling back to 2.3.1", "2.4.1 hotfix"],
  },
  {
    id: "q9-battery-replacement-13",
    category: "battery",
    question: "How much does it cost to replace the battery on the 13 inch model?",
    expectedSubstrings: ["$149"],
  },
  {
    id: "q10-auroracare-plus",
    category: "warranty",
    question: "What is AuroraCare+ and how much does it cost?",
    expectedSubstrings: ["AuroraCare+", "$199 for two years"],
  },
  {
    id: "q11-care-centers",
    category: "support",
    question: "How many Aurora Care Centers are there worldwide?",
    expectedSubstrings: ["340 Aurora Care Centers"],
  },
  {
    id: "q12-encryption-setup",
    category: "setup",
    question: "Is full-disk encryption required?",
    expectedSubstrings: [
      "required for enterprise accounts",
      "recommended for all users",
    ],
  },
];
