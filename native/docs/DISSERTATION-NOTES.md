# CN6000 — evidence notebook and report outline

Prepared 18 October 2026. This is a factual development record and writing scaffold, not a finished dissertation or student-authored submission. It contains no invented experiments, model results, supervisor approvals or claims of independent authorship.

## What the course materials require

Sources inspected: the local extracted `CN6000 Module Handbook 2026.txt`, `StudentID(UXXXXXXXX)_FamilyName 2027.txt` marking workbook extraction, and `List of milestones and deadlines.txt`, retained in the Mental Wealth working folder. These are existing course reference copies, not a newly verified Moodle state.

The handbook specifies a **10,000-word project report (65%)**, Career Pathway activity of **400 words (10%)**, progress presentation **10%**, and viva/demonstration **15%**. It gives the report submission deadline as **4 May 2027, 16:00**. The schedule also lists proposal submission **28 October 2026**, ethical approval **24 November 2026**, Career Pathway **11 December 2026**, presentation in the week of **25 January 2027**, and viva in the week of **10 May 2027**. Check live module instructions for changes. An old 2024 supervisor-allocation date appears elsewhere in the handbook; it should not override its 2026/27 schedule.

The proposal criteria require theory and practical work, programme relevance, level-6 complexity, a real problem, an element of originality, and feasibility. Tool comparison alone or simple data collection/analysis alone does not satisfy the stated practical constraints. Hence: a rewritten planner is useful infrastructure, but the Data Science contribution must be an actual evaluated research component.

The marking extraction places substantial emphasis on implementation/evaluation and literature/referencing. It also requires agreed aims, an acceptable plan, an appropriately sized product/report and the viva. Some workbook section headings aggregate report and career marks differently from the handbook; confirm final weighting in the current module material rather than inferring it from spreadsheet formulas.

## Should the Swift rewrite be mentioned?

Yes. Place it briefly in methodology/implementation and discuss its scope/cost in evaluation. Record the existing summer prototype, why a native Apple target was selected, what was reused conceptually, what was rewritten, what was tested and what remains unverified. Do not make the language switch the central research claim.

Engineering rationale: a shared Swift domain layer and SwiftUI frontend provide a practical base for native Apple features and future Watch/macOS work. The original app's calendar and history semantics are retained where implemented; a new storage format and standard native UI change some details. The migration coverage table explicitly records remaining differences.

Explain the trade-off: a rewrite consumes research time and introduces regression risk. A measured justification requires parity tests, device evidence and a bounded migration plan. Claims such as “Swift is better”, “the old TypeScript was embarrassing”, “faster” or “more usable” do not establish academic value without evidence.

## Authorship and AI evidence

Handbook p.10 says: **“YOU ARE THE AUTHOR”** and that AI-generated writing from a prompt must not be presented as the student's own; it allows research/structure assistance and sentence-level rewriting, while requiring critical evaluation and preservation of the full AI chat trail.

Accordingly, use these notes as evidence and prompts for your own explanation. Do not submit them verbatim as an independently written report. Preserve this conversation and the relevant earlier Claude/ChatGPT history. Record which code and design work was AI-assisted and what the student inspected, changed, tested and can explain. The handbook passage is not evidence that every form of AI-generated implementation is approved; confirm the module's expectations for the artefact with the supervisor before making authorship claims.

## Suggested report structure — planning allocation, not university-mandated chapter lengths

| Part | Planning words | What the student needs to establish |
|---|---:|---|
| Abstract | 250 | Actual problem, method, principal measured result and limitations; write last |
| Introduction, aims and research question | 900 | User need, programme fit, endpoint and bounded contribution |
| Literature review | 2,000 | Habit lapse/recovery, longitudinal prediction, missingness, cold start, calibration, app evidence; critically compare primary studies |
| Data and methodology | 1,700 | Dataset provenance, ethics, eligibility, labels, split, baselines, feature contract and analysis protocol |
| Design and implementation | 1,800 | Existing baseline vs new contribution; native architecture, migration decisions, predictive integration and reproducibility |
| Evaluation and discussion | 2,200 | Baselines/ablation, uncertainty/calibration, short-history results, transfer limits, software/device evidence and error analysis |
| Conclusion and future work | 650 | Answer only what the evidence supports; separate completed work from Watch/HealthKit ambitions |
| Reflection/project management | 500 | Risks, changed decisions, realistic milestones, student learning and contribution |
| **Planning total** | **10,000** | Confirm whether the abstract/references/appendices count under the live module rules |

Career Pathway is a separate assessed activity; do not silently absorb it into the above word budget.

## Evidence to keep while developing

- Baseline/source backup manifests and hashes, migration branch commits, decision log and parity matrix.
- Exact commands/toolchains, full automated logs and links to the tested commit; distinguish unit, persistence, simulator, physical-device and usability evidence.
- Before/after behaviour examples: monthly day-31 clamp; decimal quantity accumulation; historical target edits; correction/void; missing vs unsuccessful vs skipped.
- Dataset/version/licence and extraction/split/feature manifests, with no personal data in public artefacts.
- Negative results and exclusions; no fabricated model performance or behavioural benefit.
- Student's dated explanations of decisions, supervisor feedback and verified actions, plus the preserved AI trail.

## Immediate research milestones

Before the 28 October proposal date, the essential work is to agree a feasible research question and the role of the existing app with the supervisor. Finish a clean app demonstration and dataset feasibility specification, rather than promising four datasets and multiple Apple platforms as the scientific contribution. Before ethics submission, specify whether only existing de-identified data or new participants will be used. Training and app integration begin only after the research contract is sufficiently defined.

## Open questions that require real evidence

Supervisor/topic approval and any live deadline changes; permitted AI contribution; exact word-count conventions; suitable main-dataset sequences and sample counts; whether external-domain performance transfers to this app; legacy device-data migration; physical notification delivery; accessibility and usability on real Apple hardware. None is assumed resolved in this notebook.
