"""Phase 0 training smoke test.

Loads the base model in 4-bit, shows the chat template, proves that the loss
is computed on the assistant completion only (the most common silent SFT
bug), and measures training throughput and peak VRAM on the local GPU so
Phases 1 and 3 can be sized from a real number.

    python scripts/smoke_train.py                                   # Qwen3-4B-Instruct-2507, 50 optimizer steps
    python scripts/smoke_train.py --model Qwen/Qwen3-1.7B --steps 20
    python scripts/smoke_train.py --no-wandb                        # or set WANDB_MODE=offline

The toy dataset is built from the Aurora handbook fixture with synthetic cited
answers. It only needs to look like real examples (about 85% context tokens);
it does not need to be good. Nothing here is a training recipe; the real one
lives in Phase 3.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

from ragft.contract import Contract, build_messages, load_contract  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT.parent / "rag-knowledge-base" / "test-fixtures" / "aurora-notebook-handbook.md"
DOC_NAME = "aurora-notebook-handbook.md"


def toy_examples(
    contract: Contract, n: int, *, chunk_chars: int = 1000, overlap: int = 200, k: int = 5, seed: int = 0
) -> list[dict]:
    """Prompt/completion conversations shaped like production examples.

    Approximate chunking (fixed windows over whitespace-collapsed text) is fine
    here: Phase 1 uses the app's real chunker through ``npm run export:corpus``.
    """
    text = " ".join(FIXTURE.read_text(encoding="utf-8").split())
    step = chunk_chars - overlap
    chunks = [text[i : i + chunk_chars] for i in range(0, max(1, len(text) - overlap), step)]
    rng = random.Random(seed)
    examples = []
    for i in range(n):
        picked = rng.sample(chunks, k=min(k, len(chunks)))
        gold = rng.choice(picked)
        sources = [{"documentName": DOC_NAME, "normalized": c} for c in picked]
        question = f"What does the handbook say about this topic? (example {i})"
        quote = gold[:150].rsplit(" ", 1)[0]
        answer = (
            "The handbook covers this directly.\n\n"
            f"> **{DOC_NAME}** — {quote}\n\n"
            "In short, the relevant section is quoted above."
        )
        examples.append(
            {
                "prompt": build_messages(contract, question, sources),
                "completion": [{"role": "assistant", "content": answer}],
            }
        )
    return examples


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-4B-Instruct-2507")
    ap.add_argument("--steps", type=int, default=50, help="optimizer steps")
    ap.add_argument("--grad-accum", type=int, default=4)
    ap.add_argument("--max-seq-len", type=int, default=3072)
    ap.add_argument("--examples", type=int, default=256)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--no-wandb", action="store_true")
    ap.add_argument("--out", type=Path, default=ROOT / "outputs" / "smoke")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    os.environ.setdefault("HF_HOME", str(Path.home() / "hf"))
    use_wandb = not args.no_wandb and bool(os.environ.get("WANDB_API_KEY")) and os.environ.get("WANDB_MODE") != "disabled"
    if not use_wandb:
        print("wandb: off (no WANDB_API_KEY or --no-wandb); metrics go to the summary JSON only")

    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoTokenizer, BitsAndBytesConfig
    from trl import SFTConfig, SFTTrainer

    contract = load_contract()
    short = args.model.split("/")[-1]
    out_dir = args.out / short
    out_dir.mkdir(parents=True, exist_ok=True)

    tok = AutoTokenizer.from_pretrained(args.model)
    examples = toy_examples(contract, args.examples)

    # 1. Chat template: what training renders and what serving will prompt with.
    sample = examples[0]
    rendered = tok.apply_chat_template(sample["prompt"] + sample["completion"], tokenize=False)
    gen_prompt = tok.apply_chat_template(sample["prompt"], tokenize=False, add_generation_prompt=True)
    print("=" * 72)
    print("chat template, start of a training example:")
    print(rendered[:500])
    print("...")
    print("chat template, end of a training example:")
    print(rendered[-300:])
    print("-" * 72)
    print("generation prompt tail (what vLLM appends before the answer):", repr(gen_prompt[-60:]))
    print("=" * 72)

    # 2. QLoRA per PLAN.md section 7, Phase 3.
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    peft_cfg = LoraConfig(
        r=args.lora_r,
        lora_alpha=2 * args.lora_r,
        lora_dropout=0.05,
        target_modules="all-linear",
        task_type="CAUSAL_LM",
    )
    run_name = f"smoke-{short}-r{args.lora_r}-s{args.steps}"
    cfg = SFTConfig(
        output_dir=str(out_dir / "trainer"),
        run_name=run_name,
        max_steps=args.steps,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=2e-4,
        lr_scheduler_type="cosine",
        # transformers 5 dropped warmup_ratio; 3% of the run as explicit steps.
        warmup_steps=max(1, round(0.03 * args.steps)),
        bf16=True,
        gradient_checkpointing=True,
        logging_steps=5,
        save_strategy="no",
        report_to="wandb" if use_wandb else "none",
        max_length=args.max_seq_len,
        packing=False,
        completion_only_loss=True,
        include_num_input_tokens_seen=True,
        dataloader_pin_memory=False,
        model_init_kwargs={
            "quantization_config": bnb,
            "dtype": torch.bfloat16,
            "device_map": {"": 0},
            "attn_implementation": "sdpa",
        },
    )
    if use_wandb:
        os.environ.setdefault("WANDB_PROJECT", "rag-finetune")

    trainer = SFTTrainer(
        model=args.model,
        args=cfg,
        train_dataset=Dataset.from_list(examples),
        processing_class=tok,
        peft_config=peft_cfg,
    )
    trainer.model.print_trainable_parameters()

    # 3. Masking proof: decode only the supervised tokens of one batch. The
    #    prompt (system + sources + question) must be absent from it.
    batch = next(iter(trainer.get_train_dataloader()))
    ids, labels, attn = batch["input_ids"][0], batch["labels"][0], batch["attention_mask"][0]
    supervised = ids[labels != -100]
    n_total, n_sup = int(attn.sum()), int((labels != -100).sum())
    sup_text = tok.decode(supervised)
    print("=" * 72)
    print(f"one batch: sequence tokens={n_total} supervised tokens={n_sup} ({n_sup / n_total:.1%})")
    print("supervised text:", repr(sup_text))
    print("=" * 72)
    masked_ok = "Sources:" not in sup_text and contract.system_prompt[:40] not in sup_text and DOC_NAME in sup_text
    if not masked_ok:
        print("FAIL: prompt tokens are not masked, the loss would train on the context")
        return 1
    print("masking OK: loss covers the assistant completion only")

    # 4. Throughput and memory.
    torch.cuda.reset_peak_memory_stats()
    started = time.perf_counter()
    result = trainer.train()
    wall = time.perf_counter() - started
    metrics = dict(result.metrics)
    peak_alloc = torch.cuda.max_memory_allocated() / 2**30
    peak_res = torch.cuda.max_memory_reserved() / 2**30
    # transformers 5 no longer reports train_tokens_per_second; derive it from
    # the trainer's own token counter and the measured runtime.
    tokens_seen = getattr(trainer.state, "num_input_tokens_seen", None) or metrics.get("num_input_tokens_seen")
    runtime = metrics.get("train_runtime")
    tokens_per_second = (tokens_seen / runtime) if tokens_seen and runtime else None
    summary = {
        "model": args.model,
        "contract_sha256": contract.sha256,
        "steps": args.steps,
        "grad_accum": args.grad_accum,
        "effective_batch": args.grad_accum,
        "max_seq_len": args.max_seq_len,
        "lora_r": args.lora_r,
        "sequence_tokens_sample": n_total,
        "supervised_fraction_sample": n_sup / n_total,
        "wall_s": wall,
        "train_runtime_s": metrics.get("train_runtime"),
        "train_tokens_per_second": tokens_per_second,
        "num_input_tokens_seen": tokens_seen,
        "train_loss": metrics.get("train_loss"),
        "peak_vram_allocated_gb": round(peak_alloc, 2),
        "peak_vram_reserved_gb": round(peak_res, 2),
        "gpu": torch.cuda.get_device_name(0),
    }
    print("=" * 72)
    print(json.dumps(summary, indent=2))
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"wrote {out_dir / 'summary.json'}")
    if use_wandb:
        import wandb

        if wandb.run is not None:
            wandb.run.summary.update(summary)
            wandb.finish()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
