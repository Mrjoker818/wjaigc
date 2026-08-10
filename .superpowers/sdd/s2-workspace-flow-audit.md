# WJ-STABLE-001 Stage 2 Workspace Flow Audit

**Audit scope:** planning only for the Stage 2 asset/version graph. This report
inspects the current infinite canvas, node/workflow, embedded chat, and
standalone simple-chat contracts plus their cross-workspace handoffs. No
production or test behavior is changed here.

**Explicitly out of scope:** Stage 3 infinite-canvas refactoring (renderer,
viewport, selection, commands, history, or tool-registry extraction) and Stage
4 node-editor/Agent redesign. Stage 2 may define adapter boundaries those later
stages consume, but must not move their UI/state ownership or alter their
interaction semantics.

## Existing interfaces, storage, and routes

### Canvas workspace

- `src/components/infinite-canvas.tsx` owns a rich, UI-facing `CanvasImage`
  interface. Its required identity is the canvas item `id` and its media
  reference is `url`; layout (`x`, `y`, `width`, `height`) is kept on the same
  record. It also carries generation metadata, source URL, task placeholders,
  SVG/video/3D fields, and annotation fields.
- `src/lib/user-types.ts` declares a second, overlapping persisted
  `CanvasImage` contract. `Project.canvasImages` is the canvas project's
  persistence envelope; `Project.metadata` holds groups, view state, and
  annotation records. Neither interface has an `assetId`, `assetVersionId`, or
  placement identity.
- `src/components/canvas-workspace.tsx` is the integration owner. It maps
  stored project images into UI images when a project loads (lines 447-484),
  debounces a selected subset of UI image fields back to
  `Project.canvasImages` (lines 1214-1357), and mounts the canvas, node editor,
  and embedded chat.
- Canvas project data is maintained through `UserManagerCore` and the user-data
  synchronization path. It is distinct from workflow records and standalone
  chat projects.

### Workflow / node mode

- `src/lib/workflow-engine.ts` defines `Workflow`, `WorkflowNode`, and
  `WorkflowConnection`. A node has `config: Record<string, unknown>` and an
  optional runtime `execResult`; its image references and outputs are mostly
  conventionally named `imageUrl` / `imageUrls` values in that untyped config
  or result. There is no first-class asset or placement contract.
- `src/components/node-editor.tsx` narrows canvas input to a third model,
  `CanvasImageRef` (`id`, `url`, name/description, dimensions, optional
  `versionId`). `CanvasWorkspace` derives its `versionId` from
  `annotationVersionId` or a URL/time fingerprint rather than a durable asset
  version (lines 4812-4827).
- `/api/workflow/execute` receives workflow snapshots and operates on URLs.
  It normalizes and persists result URLs with `/api/save-image` before returning
  execution output, but response output remains `imageUrl` / `imageUrls`.
- `/api/workflow/save` stores an entire `Workflow` under `workflow_<id>` in
  user data. It is user-owned and authenticated, but is not linked to a canvas
  project or standalone chat project by a shared project identifier.

### Embedded chat and standalone simple chat

- `src/components/chat-panel.tsx` is the embedded canvas chat. Its
  `onAddImages(imageUrls, sourceImageId?, meta?)` callback is URL-based. Its
  pending attachment state is only `{ id, url, name }`; canvas identity is
  retained only while the attachment remains in client state.
- Canvas-to-embedded-chat uses `InfiniteCanvasProps.onSendToChat(image)` and
  `CanvasWorkspace` state (`chatInitialImage`). `ChatPanel` consumes that full
  canvas image but reduces it to `{ id, url, name }` in `pendingImages` at
  lines 1415-1430. Mention references similarly contain an `imageUrl` and
  incidental canvas item ID, not an asset version reference.
- `src/components/simple-chat/simple-chat-types.ts` defines a separate
  standalone chat project tree (`SimpleChatProject -> SimpleChatTask ->
  SimpleChatMessage`). Messages store `images?: string[]`; attachments store
  a URL and MIME data. `src/types/simple-chat.ts` is another older/simple chat
  data model whose `ImageResult` also uses only `url`, width, height, prompt,
  and model.
- `/api/simple-chat/chat` streams image events with `imageUrl`. Standalone
  chat persists its project tree in `wujie_chat_projects` and server user-data
  key `chat_simple_projects`; this is intentionally separate from the canvas
  project store.

### Media persistence

- `/api/save-image` is the common file-ingest route. It accepts multipart
  files, data URLs, and remote URLs and writes a new uploaded object/path; it
  returns a URL, filename, and optional S3 key. It does not create an asset
  record, content checksum, version, ownership link, or placement.
- `src/lib/stable-image-url.ts` has page-memory caches keyed by original URL
  and asynchronously calls `/api/save-image` for remote media. This provides
  reachability stabilization only; it does not make a shared logical identity.

## Current cross-workspace and reference flows

| Direction / entry | Current path | Identity and placement result |
| --- | --- | --- |
| Canvas -> embedded chat | Canvas context menu calls `onSendToChat`; `CanvasWorkspace` opens chat with `chatInitialImage`; `ChatPanel` appends a pending image. | Same canvas item ID is transiently reused, but only `id`, `url`, and display name remain. There is no message/attachment placement or version reference. |
| Embedded chat -> canvas | Generated/tool URLs call `ChatPanel.onAddImages`; `CanvasWorkspace.handleAddImages` creates new `ref-*` canvas items. Source ID is supplied for some image-generation paths. | A `generatedFromImageId` relationship can be recorded, but the returned child is a new canvas ID and lacks an immutable parent version or task/version relation. |
| Canvas -> node | Node mode receives a projection of canvas images. Drag/drop looks up a canvas image by URL and writes `imageUrl`, `source: 'canvas-ref'`, `sourceImageId`, and derived `sourceVersionId` into a new input node (node editor lines 1659-1690). | URL is the execution input. ID/version live only as optional node config and are not validated or resolved by a shared service. Matching by URL is ambiguous if identical URL values exist. |
| Node -> canvas | Completed workflow polling collects every `output.imageUrl` / `imageUrls` and invokes `onAddImages` (node editor lines 2348-2383). | Outputs enter canvas as new items through URL ingestion. The source node, execution ID, parent assets, and per-output placement are discarded apart from best-effort model/provider metadata. |
| Workflow internal | `getNodeInputs` appends upstream `imageUrl` / `imageUrls`, and replaces `[img:<node-id>]` references using a node-ID-to-URL map. | References are execution-local node IDs and URLs, not reusable version IDs. Annotation editing separately propagates `sourceVersionId`, but that is a derived canvas fingerprint. |
| Standalone simple chat -> canvas | `sendImagesToCanvas` writes URL arrays to localStorage key `wujie_canvas_bridge` and opens `/` in a new tab. | This is not a server-authorized transfer. It loses project, owner, prompt, dimensions, task, parentage, and placement intent. It currently writes an array whereas `CanvasWorkspace` expects `{ images: string[] }` at the same key, so the handoff is structurally incompatible and is silently ignored. |
| Canvas <-> standalone simple chat | No direct send-to-chat or receive-from-chat contract was found. The only common path is dashboard navigation and browser local storage/user-data coexistence. | No shared project or asset identity exists between these workspaces. |
| Upload / external URL -> any workspace | Canvas `handleAddImages`, workflow upload controls, and chat/image flows independently call `/api/save-image` or stabilization helpers. | A file URL can be copied or re-ingested by several callers without a durable logical asset record or content deduplication. |

## Current duplication and re-upload behavior

1. `CanvasImage` is independently declared for rendering and persistence; the
   load and save projections enumerate fields manually. This makes new media
   metadata easy to omit, and it makes a canvas item ID look like a global
   media identity even though it is only a placement ID.
2. `CanvasWorkspace.handleAddImages` persists every `data:` and `http(s):` URL
   through `/api/save-image` before creating a canvas item (lines 2629-2757).
   `handleAddToCanvas` instead adds the remote URL first and invokes background
   URL stabilization. These two entry points can therefore produce different
   file URLs for the same bytes.
3. `stable-image-url.ts` suppresses duplicate remote saves only within one
   browser process and only by exact original URL. It has no durable cache,
   checksum, owner scope, or cross-workspace idempotency key.
4. Workflow execution can persist remote result URLs server-side, then its
   canvas callback still creates new canvas records from URL output. File
   persistence is sometimes avoided for already-local result URLs, but logical
   asset duplication and lost provenance remain.
5. Node upload controls call `/api/save-image` directly and only write the
   returned URL to `node.config`; they do not add that input to the canvas
   project or register it for standalone chat reuse.
6. The standalone simple-chat bridge serializes raw URLs and has neither
   reachability stabilization nor an explicit target project. Its current
   writer/reader shape mismatch prevents successful consumption, so it cannot
   provide even the intended duplicate protection.
7. Chat history stores rendered result URLs in message fields. Reopening a
   message or sending the same URL to canvas can create another canvas item;
   deduplication is local, URL-equality based, and occurs after any URL rewrite.

## Exact Stage 2 integration points

Stage 2 should add an additive, server-authoritative asset service and thin
adapters at the following existing seams. The service owns `Asset`, immutable
`AssetVersion`, and `WorkspacePlacement`; workspace components retain their
current UI models and translate to/from those records.

1. **File ingest and task completion:** extend the successful result paths of
   `/api/save-image`, durable task/result persistence, `/api/poll-task`, and
   `/api/workflow/execute` with an internal asset-version registration step.
   The file URL remains the delivery detail; the version record carries owner,
   project, checksum/mime/dimensions, task/billing IDs, source workspace/action,
   and parent version IDs. Do not register a valid version for failed,
   cancelled, timed-out, or late-only task results.
2. **Canvas persistence boundary:** at the `CanvasWorkspace` project-load and
   auto-save mappings (not inside the renderer), introduce a canvas placement
   adapter. Store a placement ID and `assetVersionId` beside the legacy image
   fields. Canvas geometry, group membership, z-index, and view state remain
   placement/project state; they must not move onto `Asset` or `AssetVersion`.
3. **Canvas input/output construction:** replace the URL-only behavior of
   `handleAddImages` and `handleAddToCanvas` with a Stage 2 transfer request
   that accepts a version reference plus an optional placement hint. Keep URL
   fallback for un-migrated callers. The response should create/reuse a canvas
   placement and return the existing version URL, avoiding a second upload.
4. **Canvas -> embedded chat:** evolve `onSendToChat`, `chatInitialImage`,
   `pendingImages`, mention records, and persisted chat image anchors to carry
   `{ assetVersionId, placementId?, url, name }`. A chat attachment/result
   placement must be written before a request that claims the version as a
   reference, while the present URL request shape remains supported during
   migration.
5. **Canvas -> workflow:** change the `CanvasImageRef` projection and
   `handleCanvasImageDrop` to use an explicit `assetVersionId`; retain
   `sourceImageId`/derived annotation version only as legacy compatibility
   metadata. The input-image node should hold a typed asset reference envelope,
   while workflow execution resolves the current signed/local URL at run time.
6. **Workflow execution/output:** make `getNodeInputs` and workflow execution
   exchange version references alongside URLs. When an output materializes,
   register a child version with all direct input versions as parents, then
   create a `workflow-output` placement. `NodeEditor` should send that version
   to canvas rather than treating every output as an anonymous URL.
7. **Standalone simple chat transfer:** replace `wujie_canvas_bridge` with an
   authenticated server request equivalent to `sendVersionToWorkspace`.
   It needs source chat project/task/message identity, target canvas project,
   a target workspace, and placement hints. As an interim compatibility reader,
   accept both the existing raw array and `{ images }` shape, but write the new
   envelope only after the shared service exists.
8. **Standalone simple chat persistence:** add asset-version references to
   `SimpleChatMessage.images`, `ChatAttachment`, and image result events while
   retaining their current URL fields. Persist chat attachment/result placements
   in the standalone chat project/user-data boundary so reopening a chat does
   not require re-ingestion.
9. **Annotation bridge:** map current `annotationVersionId`,
   `sourceImageId`, and `sourceVersionId` to asset/version identities at the
   canvas adapter boundary. Preserve existing annotation validation behavior
   until all legacy projects have an asset-version mapping; annotation version
   fingerprints are not replacements for Stage 2 immutable media versions.

## Compatibility requirements

- Use additive schema and reader-first migration. Legacy `Project.canvasImages`,
  saved workflows, chat project trees, and URL-only task results must continue
  to open unchanged. Create asset records lazily on first Stage 2 write or an
  explicit repair/import, never destructively when a project is merely read.
- Preserve existing public request/response URL fields (`imageUrl`,
  `imageUrls`, `referenceImages`, `attachments[].url`) while adding optional
  version fields. Existing providers and media renderers continue to consume
  resolved URLs.
- A single shared version may have many placements. Deleting a canvas item,
  workflow node, or chat attachment removes/tombstones only its placement; it
  must not delete the source file, asset, other workspace references, or
  immutable history.
- Preserve source originals. Edits, removals, vectorization, crops, upscales,
  chat generation, and workflow outputs create child versions rather than
  replacing an existing version URL in place. Multi-input operations record all
  parent versions in stable order.
- Keep current project/workspace isolation and server-side owner checks. A
  transfer must validate source-version readability and target-project write
  access; URL possession alone must not authorize cross-project media access.
- Make transfer and ingest idempotent. The idempotency scope needs owner,
  source version, target workspace/project, and request/placement key; byte
  checksum may deduplicate file storage but must not collapse distinct logical
  assets without an explicit policy.
- Preserve canvas placement geometry and existing autosave/reload behavior.
  Stage 2 must not alter pan/zoom, selection, history, toolbar behavior, or
  Stage 3 canvas internals.
- Preserve workflow node IDs, connections, execution behavior, and current
  Agent/chat routing. Stage 2 adds typed reference resolution only; it does not
  redesign node interaction or Agent behavior.
- Support the existing local `/api/serve-upload/uploads/...`, `data:`, `blob:`,
  remote HTTP, image/video/SVG/3D URL cases. A failed backfill must leave the
  legacy URL renderable and visibly distinguish unavailable media from a blank
  placement.

## Candidate Stage 2 files and tests

### Likely production touch points

- New additive asset domain/types, repository, migration, authorization, and
  transfer service under `src/lib/` and `src/app/api/` (exact paths to be chosen
  in the implementation plan).
- `src/app/api/save-image/route.ts`
- `src/app/api/poll-task/route.ts`
- `src/app/api/workflow/execute/route.ts`
- `src/app/api/simple-chat/chat/route.ts`
- `src/components/canvas-workspace.tsx`
- `src/components/infinite-canvas.tsx` (prop/type adapter only)
- `src/components/node-editor.tsx`
- `src/lib/workflow-engine.ts`
- `src/components/chat-panel.tsx`
- `src/components/simple-chat/chat-area.tsx`
- `src/components/simple-chat/simple-chat-types.ts`
- `src/app/simple-chat/page.tsx`
- `src/lib/user-types.ts`
- `src/lib/stable-image-url.ts`
- `src/features/annotations/*` where version identity is validated or persisted.

### Candidate test coverage

- New pure/domain tests for asset/version parentage, idempotent transfer,
  placement lifecycle, authorization, legacy URL fallback, and failed/late task
  non-version creation.
- New API tests for authenticated `sendVersionToWorkspace`, cross-project
  rejection, asset ingest reuse, task-to-version linkage, and workflow-output
  lineage.
- Extend `src/__tests__/lib/workflow-engine.test.ts` for reference envelopes
  while retaining URL resolution compatibility.
- Extend `src/__tests__/components/workflow-persistence-wiring.test.ts` and
  `src/__tests__/components/node-editor-execution-wiring.test.ts` for durable
  input/output reference wiring.
- Extend `src/__tests__/components/simple-chat-workspace-return-contract.test.ts`
  with a real transfer contract; add focused tests for both legacy bridge reader
  shapes until it is retired.
- Add focused embedded-chat/canvas handoff tests near existing
  `chat-panel-*`, `canvas-*-contract`, and `canvas-generation-reconciliation`
  suites to assert same-version transfer, distinct placements, and preserved
  source lineage.
- Add API persistence tests adjacent to `save-image-auth-contract`,
  `workflow-save-ownership`, `workflow-execution-persistence-wiring`, and
  `simple-chat-auth` to cover ownership and reload semantics.
- Add Playwright coverage for standalone chat -> chosen canvas project,
  canvas -> embedded chat -> derived result, canvas -> workflow -> canvas, and
  reload/deletion cases proving that deleting one placement leaves the other
  workspace reference functional.

## Planning conclusion

The current product has workable URL transports and a partial, annotation-only
version fingerprint, but no shared asset identity. Stage 2 should introduce the
asset graph at storage/transfer boundaries and maintain URL-compatible adapters
at every existing UI edge. It should not use the Stage 2 work to refactor the
canvas or redesign the node/Agent workspaces.
