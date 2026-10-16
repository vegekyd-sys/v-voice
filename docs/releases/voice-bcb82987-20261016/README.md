# Voice #23 frontend release registration

The entry is released separately from the already-loaded Gateway plugin. The only changed product file is `lab/gpt-live-h5/app.js`; all plugin, lib and server files are byte-identical to a9ac5168. The Gateway keeps the old plugin path, config, PID and invocation. This avoids a Gateway restart solely to rename an unchanged plugin directory.

Read `status` before treating this as active. After activation, audit the actual rtc-h5 process path against `entryDirectory` and all 177 hashes in `artifact-manifest.json`; independently verify served `app.js`. Read the actual Gateway plugin path and hash its files against the a9ac registration (also identical to this manifest for those paths). The symlink alone is not running-version evidence, and the platform core drift sentinel does not cover Voice.

Never commit the native provider environment, dedicated Lark configuration, tokens, transcripts, audio or databases. Activation and production acceptance receipts are private; only non-sensitive summaries and hashes belong here.

Production acceptance used synthetic natural speech through actual GPT Live and SeedDuplex ASR/audio and the real host call controller. Both returned to idle with reset transcript and no console errors. The exact alternate farewell is additionally covered by the regression copied from the observed production failure; live GPT used the canonical wording on this run. This does not claim physical iPhone Safari or new backend-task acceptance.
