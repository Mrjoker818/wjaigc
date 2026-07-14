# Bottom Toolbar Request Audit

Audit target: `src/components/infinite-canvas.tsx` bottom-toolbar entries and the panels they open.

| Tool | Request route / behavior | Model and provider handling | Asset handling | Result |
| --- | --- | --- | --- | --- |
| Canvas generation / HexCube | `/api/generate` | Canvas model and provider are included in the request and polling payload | `/api/save-image` | Verified |
| Image to 3D | `/api/image-to-3d` | Request model precedes provider defaults | Existing server image URL | Verified |
| Language edit / Agent | `/api/edit`, `/api/agent-edit` | Selected model/provider propagated by the editor | Existing canvas image URL | Verified |
| Video generation and edit | `/api/generate`, video routes | Video model/provider is retained by the panel | Existing canvas media URL | Verified |
| Brand E-commerce | `/api/brand-ecommerce` | Selected image/chat model and provider are propagated | Removed browser `blob:` fallback; upload must persist first | Fixed |
| Refine Engine | `/api/refine-engine` | Composite model key is split into model and provider | Existing server image URL | Verified |
| Font Design | `/api/font-design/*` | Selected image model resolves provider for submission and polling | No browser-only reference image submission | Verified |
| Brand Factory | `/api/brand-factory` | Image and LLM provider IDs accompany selected models and polling | `/api/save-image` | Verified |
| Logo Skill | `/api/logo-skill` | Composite image/LLM model keys preserve provider IDs | No browser-only reference image submission | Verified |
| Scene Studio | Local Three.js scene plus `/api/generate` fallback | AI fallback uses selected generation configuration | Remaining `blob:` URL is only a local `.glb/.gltf` preview, never sent remotely | Verified |
| Brand Packaging | `/api/brand-packaging/generate` | Selected image/chat model and provider are included in submit/poll requests | Upload now persists via `/api/upload` | Fixed |
| Display3D Pro | `/api/display-3d/*` | Requested model now wins over provider default, including decomposition and polling | Upload now persists via `/api/upload`; server rejects `blob:` URLs | Fixed |
| AI PSD | `/api/ai-psd/create` plus async worker | Image/LLM provider IDs now persist through DB task storage and worker calls | `/api/save-image` | Fixed |
| Sticker Assistant | `/api/generate`, `/api/image-edit` | Composite model key is split into model and provider | `/api/save-image` | Verified |
| AI PSD downloads / Sticker ZIP | Local download only | Not applicable | `blob:` URL is used only to download generated files locally | Verified |

All `URL.createObjectURL(file)` searches under `src/components` now resolve only to Scene Studio's local model-preview path.
