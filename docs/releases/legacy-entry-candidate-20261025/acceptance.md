# Legacy entry compatibility candidate

The browser now redirects registered historical Feishu group and DM entry names to a canonical URL for the exact same account and native conversation. It then uses current visitor authentication. Fixed custom entries, callbacks, API access, device grants and historical report authorization retain their existing contracts.

Validation:

- 51 tests passed: Feishu caller identity, browser login, card confirmation, conversation directory, unified access, iOS web delivery and entry startup.
- Both legacy group and DM fixture URLs opened in the Codex in-app browser, changed to their corresponding canonical URL, and rendered the full phone page. The candidate update appeared in the homepage changelog.
- The local fixture adapts its HTTP loopback Origin to the hosted HTTPS contract. Its Gateway, Feishu mutation and call creation adapters throw; this is UI/entry evidence, not a production identity or audio test.
- iOS shell source manifest regenerated because the shared changelog source changed. No native binary was built or published.

Production browser redirects are not deployed. The separate platform change handles existing and future Feishu menus/tabs. The real external-user confirmation that the 十二家 entry now opens the phone page comes from the earlier targeted menu repair, not from this candidate.
