# Retrieval eval (K=5)

## Summary

| Strategy | n | hit@K | MRR | mean top-1 sim |
| --- | --- | --- | --- | --- |
| dense-only | 12 | 0.917 | 0.861 | 0.537 |
| hybrid-rrf | 12 | 0.917 | 0.917 | 0.531 |

## Per-question rank of first relevant chunk

| Question ID | Question | dense-only: rank | hybrid-rrf: rank |
| --- | --- | --- | --- |
| q1-pro-price | What is the price of the Aurora Notebook Pro? | #1 | #1 |
| q2-warranty-length | How long is the warranty? | #1 | #1 |
| q3-battery-cycles | How many charge cycles does the battery last? | #1 | #1 |
| q4-phone-support | What's the phone number for phone support? | #1 | #1 |
| q5-13-model-code | What's the model code for the 13 inch Aurora Notebook? | #1 | #1 |
| q6-15-ram | How much RAM does the Aurora Notebook 15 have? | #1 | #1 |
| q7-recycling | How do I recycle my old Aurora device? | #1 | #1 |
| q8-firmware-trackpad | The trackpad is unresponsive after a firmware update — what should I do? | #1 | #1 |
| q9-battery-replacement-13 | How much does it cost to replace the battery on the 13 inch model? | #1 | #1 |
| q10-auroracare-plus | What is AuroraCare+ and how much does it cost? | miss | miss |
| q11-care-centers | How many Aurora Care Centers are there worldwide? | #1 | #1 |
| q12-encryption-setup | Is full-disk encryption required? | #3 | #1 |

> `miss` = no chunk in top-K matched any expected substring.
> `#N` = first relevant chunk was at rank N (lower is better).