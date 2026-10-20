# Data Science plan — design only

Status: no dataset preparation, training, model integration or behavioural experiment has been performed in this migration. This document refines the existing research proposal rather than asserting completed results.

## Research question and contribution

**Does past recovery history improve prediction of the next recorded successful outcome after an unsuccessful reporting period, beyond frequency and streak baselines, especially with little observed history?**

The practical contribution would be a reproducible predictive study plus a working native planner that can present a validated model's output with uncertainty and a fallback. The Swift rewrite is enabling engineering; the scientific contribution is the experimental design, leakage-free features, comparison, calibration, error analysis and justified interpretation. A language migration alone is not a Data Science dissertation.

Define the target before selecting models. Candidate primary endpoint: among eligible explicitly unsuccessful reports, whether the next scheduled reporting period has an explicitly successful report. Missing next reports are not failures; report coverage and define a separate missingness analysis. A secondary time-to-recorded-return task may treat unfinished follow-up as censoring, but must not be mixed with the binary task. Do not call an unobserved real-world behaviour an observed failure.

## Dataset decision

| Dataset | Proposed role | Decision gate |
|---|---|---|
| [StickK / Zenodo 8347427](https://zenodo.org/records/8347427) | Primary candidate: naturalistic commitment/report sequences | Verify reporting periods, explicit status and timestamp meaning, user linkage, repeated attempts and sufficiently complete raw sequences. Aggregated analysis tables alone cannot support this target. |
| [StepUp / 24 Hour Fitness](https://osf.io/9av87/?view_only=8bb9282111c24f81a19c2237e7d7eba3) | Alternative weekly return-to-gym outcome | Attendance is a different endpoint; account for experimental assignment, zero attendance vs unavailable observation, follow-up duration and reuse licence. |
| [HabitWalk](https://osf.io/58pbr/) | Small secondary longitudinal study and missingness/sensitivity analysis | Local author dictionary distinguishes daily steps, walking-session duration, reminders and SRBAI. Do not treat unavailable Garmin recordings as non-performance or automaticity as the same target. |
| [HeartSteps V1](https://github.com/klasnja/HeartStepsV1) | Separate optional question about proximal activity/suggestion response | Micro-randomised availability and treatment assignment must be respected; a notification-response model would be a different study from recovery prediction. |

Use one main dataset and one carefully justified secondary check at most. Do not concatenate these into a generic habit label. The author's existing research notes record CC BY 4.0 for StickK, HabitWalk and HeartSteps, with StepUp reuse permission unresolved. Verify the exact downloaded release and licence before analysis/publication. On 18 October the Zenodo page and HeartSteps author repository were reachable; OSF pages were not retrievable through the browser service, so their licence/access status has not been newly confirmed. The existing local download log reports completion and archive checks, not a cleaned usable research sample.

## Phases and exit criteria

1. **Feasibility and scope.** With the supervisor, agree endpoint, programme fit, use of the pre-existing application and AI assistance. Produce a small data dictionary/eligibility specification and a go/no-go decision. Exit only if sequences and explicit outcomes support the target; otherwise revise the research question before modelling.
2. **Ethics and provenance.** Review data use and identifiability; remove profile text, free text and unnecessary fields before any research extract. Keep raw data outside the app and public repository. Record source/version/licence/checksum. Use approved university storage and seek course ethics approval where required. Exit with permitted, minimal research fields and an approved protocol.
3. **Sequence preparation.** Parse reporting cadence and timestamps, keep missing and explicit failure distinct, handle duplicate/corrected reports and multiple commitments per participant, and publish a flow diagram of exclusions. Report numbers of users, eligible transitions, positives, negatives and missing follow-up. Exit with tested, reproducible tables and no unsupported label assumptions.
4. **Splitting and feature contract.** Split by participant so their commitments cannot leak across sets. Within histories, enforce chronological prediction boundaries. Fit preprocessing and tuning only within training/validation. Test data remains untouched until final evaluation. Exit with a frozen split manifest and a feature-time audit.
5. **Baselines.** Compare majority/prevalence probability, recent-success frequency, time since last recorded success, current streak and an interpretable logistic model without recovery-history features. Report a missingness-aware fallback. Exit with working calibrated probability baselines, not only classification accuracy.
6. **Recovery features and ablation.** Add prior unsuccessful-to-success transitions, durations of prior recorded gaps/returns, number of completed recovery episodes, post-return persistence and history length. Compute every value using facts available before the prediction time. Compare the same model with and without this feature group to isolate its incremental value. A flexible tree model is optional only if sample size and study time support it.
7. **Evaluation.** Pre-specify primary metric: log loss or Brier score for probabilities. Also report PR-AUC under imbalance, ROC-AUC, calibration curves and coverage. Use participant-level bootstrap intervals rather than treating repeated rows as independent. Evaluate short histories separately (for example 1–3, 4–7, 8–14 observed periods, then longer histories), with subgroup counts and uncertainty; freeze bins before inspecting test results. Report negative results honestly.
8. **Transfer assessment.** Identify which training features exist in the planner. External contractual self-reports may not match app habits, and gym/walking datasets do not establish broad transfer. If no valid app population exists, present external-dataset results and a technical demonstration; do not claim app predictive accuracy or causal behavioural improvement.
9. **App integration after research.** Export a small model and immutable feature specification, preprocessing constants, model version, training domain, tested input ranges and confidence/abstention policy. Prefer on-device inference where practical. Validate exported Swift/Core ML predictions against a reference test vector set before enabling the screen. Raw external participants never become app users or appear in the planner database.
10. **Evaluation of the integrated artefact.** Measure offline correctness, inference latency, persistence and explanation/fallback behaviour. Any study of whether suggestions improve habits requires a separate prospective protocol and comparison; classification results alone cannot establish intervention effectiveness.

## Planned application boundary

`Snapshot at prediction time → eligible historical outcomes → versioned feature vector → predictor → probability/uncertainty or abstention → optional user-facing explanation`.

Keep this boundary separate from progress/awards. The current growth counter is not a model feature without a defined historic reconstruction rule. The current snapshot keeps observation `recordedAt` and correction history, but configuration/lifecycle/checklist knowledge-time reconstruction is incomplete. Do not use retrospective recalculated charts as leakage-free training data. Design a complete bitemporal event contract before any in-app research logging.

If evidence is too weak, show no prediction and retain the ordinary planner. Do not invent a recovery probability from the 7/14/30/66 award ladder. Do not present a probability of a recorded outcome as a judgment of a person's motivation.

## Research deliverables

Data dictionary, exclusion flow, split/feature manifests, reproducible analysis environment, baseline/ablation tables with uncertainty, calibration and error figures, model card, export test vectors, integration tests and a limitations section. Model selection and results remain future work; this plan contains no fabricated scores or claim of novelty.
