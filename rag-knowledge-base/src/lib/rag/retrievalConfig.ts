// Why: retrieval defaults live in a dependency-free module so pure code (the
// prompt contract, tests, export scripts) can read them without importing
// prisma, which constructs a client at import time.
//
// K=5 is a common sweet spot for RAG — enough context to answer follow-up-style
// questions, few enough that the LLM prompt stays under budget and doesn't
// dilute focus. Both the dense baseline and production hybrid retrieval use it,
// and the fine-tuned answer model is trained on contexts of this size.
export const RETRIEVE_DEFAULT_K = 5;
