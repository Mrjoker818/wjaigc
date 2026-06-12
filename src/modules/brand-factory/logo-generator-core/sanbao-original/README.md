# Logo Generator Skill

Generate professional logo creative directions and prompts for any brand or business.

## Quick Start

1. Provide a brand name and a brief describing what is being branded
2. Optionally specify logo type, audience, preferred style, and target platform
3. Get a complete creative package: direction, symbol concept, visual system notes, and platform-specific prompts
4. Optionally generate a logo image directly

## Features

- **Multi-type support**: company, brand, product, cultural/creative, campaign, event, app, sub-brand logos
- **Platform-ready prompts**: Universal, GPT Image, Midjourney, Flux, Ideogram variants
- **Direct image generation**: render a polished brand-system-board logo when requested
- **Reference-aware**: transfer design systems from references without copying
- **Iterative refinement**: revise with `revision_notes` while preserving good directions
- **Professional output**: brand-system-board, identity-board, standalone-logo, square-avatar, or transparent-asset formats

## Input

| Field | Required | Description |
|-------|----------|-------------|
| `brand_name` | Yes | Brand/company/product name |
| `brief` | Yes | What is being branded and its context |
| `logo_type` | No | Type of logo (inferred if omitted) |
| `audience` | No | Target audience |
| `preferred_style` | No | Visual style preference |
| `reference_style` | No | Visual reference description |
| `output_layout` | No | Render layout format (default: brand-system-board) |
| `target_platform` | No | Which platform prompts to emphasize |
| `render_image` | No | Whether to generate an image directly |
| `revision_notes` | No | Feedback for iteration |
| `output_language` | No | Response language (zh-CN or en) |

## Output

- **Logo Direction**: positioning, mood, palette, typography, composition
- **Symbol Concept**: core metaphor, icon form, negative space, alternative routes
- **Visual System Notes**: lockups, one-color behavior, small-size behavior, usage notes
- **Brand System Board Layout**: numbered module grid layout specification
- **Final Prompts**: platform-specific prompt variants
- **Generated Logo**: when `render_image` is true and an image tool is available

## License

MIT
