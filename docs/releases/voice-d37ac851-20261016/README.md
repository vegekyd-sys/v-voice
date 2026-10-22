# Voice #25 publication registration

Voice entry d37ac851 ships the missing October 16 homepage notes, authenticated pending-work status and bounded causal diagnostics. The Gateway plugin remains at a9ac5168 with identical plugin bytes. No Gateway restart, config, Worker or systemd kill-policy change.

Platform #396 checks active calls, session creation and backend delivery before cutover. This first migration used only the exact verified bcb82987 source: signal the H5 process, wait for its existing drain to exit normally, then cancel its automatic restart delay and switch. Its receipt confirms a clean exit, no forced kill and one activation attempt.

Production verification checked the live process path and all 177 package hashes, the unchanged Gateway identity/config and plugin bytes, ready state and zero pending work. The authenticated public homepage shows the October 16 notes in the in-app browser with no console errors. Candidate validation covers 80 Voice tests and 12 final controller tests, with shared Gateway unchanged and no database copy.

This is not a repair acceptance for late tool-result replies or busy natural hangup. Those remain separate tasks; physical iPhone Safari was not retested. Never commit native environment, credentials, transcripts, raw audio, browser profiles or databases.
