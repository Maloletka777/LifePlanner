# Proposed research and data sources

Working question: does previous recovery history improve prediction of the next recorded outcome after an unsuccessful period, compared with a streak/frequency baseline, particularly with short histories?

The application has no training population. Research must distinguish explicit non-performance from missing reports and evaluate on held-out users without future-information leakage. No trained model or evidence of intervention effectiveness is currently included.

| Dataset | Source | Role and limitations | Licence/access |
| --- | --- | --- | --- |
| StickK | [Zenodo](https://zenodo.org/records/8347427) | Main candidate; raw report sequences are required, not just processed aggregates | CC BY 4.0 |
| StepUp / 24 Hour Fitness | [OSF](https://osf.io/9av87/?view_only=8bb9282111c24f81a19c2237e7d7eba3) | Alternative: weekly return to gym attendance | Public author-shared files; explicit reuse licence not confirmed |
| HabitWalk | [OSF](https://osf.io/58pbr/) | Small longitudinal walking/automaticity study with substantial missingness | CC BY 4.0 |
| HeartSteps V1 | [Author repository](https://github.com/klasnja/HeartStepsV1) | Alternative: short-term response to activity suggestions; account for randomisation and availability | CC BY 4.0 |

These datasets measure different outcomes and should not be concatenated into one generic habit-recovery label. Raw public records can contain personal or sensitive information; derived research tables should use only necessary de-identified fields. Cite each dataset's authors and follow its documentation.

Local downloads live in `../datasets/` relative to the application folder and are not included in this repository. The current stage is dataset assessment and proposal development. Full sequence cleaning, usable-sample verification, model comparisons and transfer evaluation remain future work. No confirmed claim of novel methodology or behaviour improvement is made.
