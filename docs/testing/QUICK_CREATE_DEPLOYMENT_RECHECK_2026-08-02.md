# Quick Create Deployment Recheck - 2026-08-02

## Follow-up P0 Core Canvas Validation

Environment:

- Deployment: `https://wjaigc.coze.site/`
- Commit under test: `4d58688e9b08af516d0c3c4a63ba572560694982`
- Browser: authenticated Chrome

| Flow | Result | Evidence |
| --- | --- | --- |
| Clipboard image enters canvas | PASS | Real JPEG appeared as `canvas image`; `test-results/screenshots/deploy-2026-08-02-p0-canvas-paste-current.jpg` |
| Image selection | PASS | Selected toolbar appeared; `test-results/screenshots/deploy-2026-08-02-p0-canvas-resize-selected.jpg` |
| Image move | PASS | Second real pointer drag visibly moved the image; `test-results/screenshots/deploy-2026-08-02-p0-canvas-move-retry.jpg` |
| Image proportional resize | PASS | Bottom-right handle expanded the image while preserving its aspect ratio; `test-results/screenshots/deploy-2026-08-02-p0-canvas-resize-precise.jpg` |
| Image delete | PASS | Exact `selected-image-delete` control removed the selected image in the real browser; `test-results/screenshots/deploy-2026-08-02-p0-canvas-delete-testid.jpg` |
| Refresh and reopen recovery | FAIL / P1 | Project retained its one image, but the reopened canvas viewport was blank because persisted image coordinates were outside the reset viewport. See `AUD-20260802-003`. |

## Scope

- Deployment: `https://wjaigc.coze.site/`
- Git commit: `4d58688e9b08af516d0c3c4a63ba572560694982`
- Browser: authenticated Chrome session
- Account: administrator account `Mr.joker`
- Test time: 2026-08-02 (Asia/Shanghai)

## Regression: malformed SSE fallback

### Reproduction inputs

- Mode: Quick Create
- Image model override: `Gpt Image 2 / AI link image`
- Aspect ratio: `1:1`
- Quality: `high`
- Output count: `3`
- Prompt: three white-background teal cube product images, soft studio light, clean commercial quality

### Result

PASS with an explicit fallback:

1. The compiler changed from the malformed-SSE path to the fallback state.
2. The UI showed a confirmation that the original request had been submitted.
3. The UI disclosed that professional prompt compilation was unavailable and that the original request was submitted instead.
4. One application task, `async-1785628488840-y7keqm`, progressed from processing to completed.
5. The task completed after approximately 65 seconds.
6. The existing project image count changed from `31` to `34`.
7. Three generated images were visible in the canvas after completion.
8. The administrator cloud-task monitor displayed completed records requested as `AI link image / gpt-image-2`.

### Evidence status

- Browser observation transcript: recorded in this report with task ID and image-count deltas.
- Screenshot and DOM evidence were not saved during the first live run because the browser screenshot API did not honor a file-path option. They are intentionally not claimed as artifacts.
- The evidence capture procedure was corrected before the subsequent canvas persistence check below.

## Regression: new-project Quick Create

### Reproduction inputs

- Create a new blank project from the dashboard.
- Wait for the canvas, Quick Create button, and image generator toolbar.
- Open Quick Create.
- Image model override: `Gpt Image 2 / AI link image`
- Aspect ratio: `1:1`
- Quality: `high`
- Output count: `1`
- Prompt: white-background teal cube product image, soft studio light, clean commercial quality

### Result

PASS:

1. The application remained in the new project canvas and did not navigate back to the dashboard.
2. The compiler entered the professional-creation-plan state.
3. The request became an application task after approximately 10 seconds.
4. The canvas displayed a submitted/waiting state at 10 percent.
5. The processing card completed after approximately 20 seconds.
6. One 800 x 800 generated image was visible in the new project canvas.
7. After a full browser reload, the dashboard still displayed `8 projects / 59 images`.
8. Reopening the new project restored the generated 800 x 800 image.

## Canvas core interaction follow-up

### Selection and deletion

PASS:

1. The generated image was selected by clicking it in the canvas.
2. The contextual image toolbar appeared with remove-background, SVG trace, element decomposition, erase, and delete actions.
3. Clicking delete removed the image immediately.
4. Returning to the dashboard after persistence reduced the total image count from `59` to `58`.
5. The test project no longer showed the deleted image after a dashboard refresh.

### Saved evidence

- Screenshot: `test-results/screenshots/deploy-2026-08-02-dashboard-after-delete-persisted.jpg`
- DOM transcript: `test-results/console/deploy-2026-08-02-dashboard-after-delete.dom.txt`
- Captured URL: `https://wjaigc.coze.site/?view=dashboard`

The empty test project was created specifically for this validation. Drag, resize, multi-select, undo, and redo remain separate verification items.

## Canvas input follow-up

### Clipboard image paste

PASS:

1. A local JPEG test image was placed into the authenticated browser clipboard.
2. A normal `Ctrl+V` action added the image to the empty cloud project.
3. The image appeared as a selected canvas node with the visible size `1920 x 863`.
4. The contextual image toolbar became available.
5. Deleting the node and returning to the dashboard restored the global image count to `58`.

### Native file chooser

NOT VERIFIED because the Chrome extension rejected the local file handoff with `Not allowed`. No image was uploaded by that failed action and no project data changed. This is a browser-extension file-access permission blocker, not evidence of an application upload failure.

### Movement and resize

PASS for live interaction, FAIL for refresh recovery:

1. A second real pointer drag visibly moved the pasted image.
2. A real drag from the bottom-right selection handle enlarged the image while retaining its proportion.
3. Selection, movement, resize, and delete produced no browser console errors or warnings.
4. After browser refresh and reopening the saved project, the image data and media file existed but the canvas viewport was blank. This is tracked as `AUD-20260802-003`; it is not being counted as a passing persistence test.

### Saved evidence

- Screenshot after drag attempt: `test-results/screenshots/deploy-2026-08-02-canvas-after-drag-attempt.jpg`
- DOM transcript after drag attempt: `test-results/console/deploy-2026-08-02-canvas-after-drag-attempt.dom.txt`
- Screenshot after successful movement: `test-results/screenshots/deploy-2026-08-02-p0-canvas-move-retry.jpg`
- Screenshot after successful proportional resize: `test-results/screenshots/deploy-2026-08-02-p0-canvas-resize-precise.jpg`
- Screenshot after cleanup: `test-results/screenshots/deploy-2026-08-02-clipboard-paste-cleanup.jpg`
- Dashboard screenshot after cleanup persistence: `test-results/screenshots/deploy-2026-08-02-clipboard-paste-delete-persisted.jpg`
- Dashboard DOM transcript after cleanup persistence: `test-results/console/deploy-2026-08-02-clipboard-paste-delete-persisted.dom.txt`

### Image download

NOT VERIFIED:

1. A real canvas image was selected, `下载` was opened from the image action menu, and the PNG download dialog was confirmed.
2. The dialog closed without a page error or console error.
3. The browser-control connection did not emit a downloadable-file event for the client-side Blob anchor download, so no local artifact can yet prove that the browser saved the file.
4. This is a test-evidence gap, not a product defect. A manual Chrome download-shelf verification or an application-level download telemetry assertion is still required.

## P0 Authentication and Entry Flow

PASS:

1. The authenticated dashboard loaded with the expected administrator identity.
2. Opening the account menu and selecting `退出登录` returned the browser to the unauthenticated `选择入口` page at `https://wjaigc.coze.site/`.
3. The entry page exposed both `无限画布` and `智能对话` choices, rather than leaving the user on a blank workspace.
4. Selecting `无限画布` opened the username/password form.
5. The browser's existing saved login completed the form submission and returned to the authenticated project dashboard.
6. Logout and relogin produced no captured browser console errors or warnings.

### Saved evidence

- Dashboard before logout: `test-results/screenshots/deploy-2026-08-02-p0-auth-before-logout.jpg`
- Account menu: `test-results/screenshots/deploy-2026-08-02-p0-auth-account-menu.jpg`
- Entry page after logout: `test-results/screenshots/deploy-2026-08-02-p0-auth-after-logout.jpg`
- Login form: `test-results/screenshots/deploy-2026-08-02-p0-auth-login-form.jpg`
- Authenticated dashboard after relogin: `test-results/screenshots/deploy-2026-08-02-p0-auth-relogin.jpg`

## P0 Baseline Status Before Fixes

| Required flow | Current real-browser status |
| --- | --- |
| Entry page and login | PASS |
| Logout and relogin | PASS |
| Clipboard image enters canvas | PASS |
| Select, move, resize, delete | PASS |
| Quick Create prompt/model/task/result | PASS, with provider-routing audit P1 |
| Project refresh/reopen recovery | FAIL / P1 (`AUD-20260802-003`) |
| Native file-picker upload | UNVERIFIED: Chrome extension local-file permission blocked the test handoff |
| Download saved file | UNVERIFIED: client-side Blob download did not surface a downloadable-file event through the browser-control connection |

## Open finding: selected provider versus recorded provider

Both verified Quick Create flows selected `Gpt Image 2 / AI link image` in the UI. Completed canvas cards showed `FHL image model`, and the provider label was absent after a full reload and project reopen.

This report does not claim that the actual provider was FHL. The deployed application may retry a failed provider with another configured candidate model. The implementation must determine whether:

1. AI link was unavailable and the backend deliberately fell back to FHL, or
2. Provider identity was lost between Quick Create, durable task payload, recovery submission, polling, and canvas metadata.

Until this is established, provider selection accuracy is NOT VERIFIED. The product must disclose a provider/model fallback and persist both requested and actual routing metadata.

## Conclusion

The malformed-SSE fallback fixed by commit `4d58688` is verified in the deployed environment for an existing project with three outputs and a newly created project with one output. Canvas selection and deletion persistence are also verified. This is not a release approval: provider-routing observability and the wider regression suite remain outstanding.
