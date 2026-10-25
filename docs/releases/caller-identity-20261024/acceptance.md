# Production acceptance

Voice `04d1022370ff2caff99a65c81e5051b8bad59425` was merged through PR #125, passed main CI, and was packaged from the clean merged source. The same 226-file artifact is running on web/iOS and the Shanghai device service; both nodes are ready with admission open. The original release `b0717249e8993e5685301e541b5b5263646a4725`, launch parameters and private environment were preserved for rollback.

Only the two Voice services were switched. The production Gateway PID, invocation, startup timestamp and configuration hash match the pre-release snapshot. No Gateway code, configuration or restart was part of this release.

The production group entry was refreshed in the in-app browser. It shows an enabled dial button and account connection below the dial area, with no top-right account label/switch link. The homepage update dialog visibly shows “修复群电话来电账号识别” and this release's four delivered changes. Public HTTP checks matched the exact shipped bytes for changelog, app, caller-context, UI bundle and iOS shell metadata; the guest endpoint is ready without an authenticated account label.

Release validation: 887 main tests, 95 speaker-native tests, 11 fleet-controller tests, UI build and iOS shell consistency passed. Candidate tests used the actual three models with the same synthetic speech and a synthetic verified-account label; all returned the correct name and audio, and GPT acknowledged the per-call context. Real desktop Feishu SDK/OAuth was verified separately before release. Production verification did not start paid calls or claim phone permissions, real two-account switching, native App/firmware installation or physical-device audio acceptance.
