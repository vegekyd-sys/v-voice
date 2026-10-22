# Caption continuity and iOS build 19

Tianyi authorized main integration, the production web update and a new signed package on the requested physical iPhone. This release changes native caption assembly and shared H5 presentation through existing Voice interfaces. Candidate tests cover the integration scope; no Gateway or Worker code change or shared VLab promotion is required.

GPT fragments now keep a stable message identity when their native turn identity arrives late. Xiaohe/Grok assistant deltas accumulate until a full final caption reconciles the row. Shared H5, Reaction context and display receipts keep original chronological ordering when messages complete. Streaming text still arrives incrementally; this does not promise word-level alignment with speech.

PR #68 merged as `3fe9fcc25039c620e7745bf83a14b14c9d523f29`. The exported build 19 comes from its exact parent source `06317a892639af16697cf67498b5962ec8a335f8`; complete source trees are identical. The frozen production package uses the merge commit and verifies all 205 files.

Local verification: Swift core 29, native WebRTC/WKWebView caption tests 7, Node 715, Speaker 95. Signed archive and independently extracted IPA both pass release verification. Device inventory reads 1.0.0 (19) after overwrite installation and normal app launch succeeds. No uninstall, binding reset or automatic/paid call was performed. Real-call caption acceptance on the phone remains pending.

See `release.json` for finalized web delivery and CI results. Homepage notes are maintained in `lab/gpt-live-h5/changelog.mjs` and its generated H5/native copies.

## Rollback

The original signed build 18 IPA was copied and its SHA verified. The old web release remains retained. H5-only release receipts and the controller are kept privately in the build delivery directory; the deployed release also retains its installation receipt and original launcher bytes. Before any switch or rollback, require known zero calls, session creation, background tasks, open Gateway voice sessions and relay connections. Compare the current pointer, unit, private environment hashes and Gateway identity with the recorded snapshot. Restart only `openclaw-rtc-h5.service`; never restart the Gateway for this release.
