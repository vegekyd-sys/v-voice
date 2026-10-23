# Paired voice Q&A candidate — 2026-10-23

Status: candidate only; not merged or released. Runtime source `b53e7fe29edc0cfbd2d2a21a4fd2c098f9489684`, version `voice-session-qa.20261023.1`, main baseline `42ff625`. Artifact: 214 files; file-list SHA-256 `ec9a3c31416f2cd4211cb38f20e728acf7fd2c19b7f67634eeb61420d6bb291c`.

Completed substantive responses now combine the admitted final user transcript with the answer in one bound-session message. Response identity keeps later questions from replacing the original. Task request identity retains the original question through acknowledgement, intervening turns and hangup. Speaker admission, progress suppression, idempotent send retries and server-owned destinations are preserved.

Real provider ordering exposed Grok response creation before final input ASR. Reserve the question on speech start and fill its final text without rebinding an older question. Reproduced in unit and direct-session integration tests; initial missing-delivery evidence retained outside the repository.

Validation: 761 full Node tests, 84 direct-session tests including the observed ordering, and iOS shell consistency passed. Final exact artifact: six synthetic-audio calls (SeedDuplex and Grok × DM/group/personal), six actual audio responses, six confirmed single-message Q&A deliveries, six matching session-history records. Feishu desktop inspected all three destinations. ASR spelling errors remain faithful to the source; this is not an ASR-quality benchmark.

DM/group use the existing isolated VLab pilot. Personal calls use a temporary loopback candidate with the original Gateway/bot and no historical context sent to the model; the formal Voice process was unchanged, and the probe exited. The VLab bot is not added to the original personal group; its personal-sync setting remains disabled. No Gateway restart, production configuration change, formal release, or new caller exposure. Final candidate readiness: ready, all activity counters zero; source/environment rollback baselines retained.

Limits: prior VLab DM child-result defect remains separate; background result pairing is covered by fixtures, not these no-tool live calls. GPT Live has server-event tests only. Physical phone speech, stutter, ambient talk and interruption acceptance remain pending.

PR integration subsequently includes main `2d8cd357b9aaaffee94c9e1076b0761115a2b01e` (native interruption and iOS build 23). Conflicts preserve both response-scoped playback clearing and Q&A ownership; generated H5 resources were rebuilt. Integration passed 771 Node tests and the iOS resource check. This integration was not deployed: the six-call acceptance and running candidate remain frozen at `b53e7fe`.
