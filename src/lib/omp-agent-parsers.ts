/**
 * Oh My Prompt — Agent / Ecommerce result parsers
 * Adapted from oh-my-prompt repository (agent-result-parser.ts + ecommerce-result-parser.ts)
 * Parses structured JSON from LLM responses into typed results.
 */

// ─── Types ────────────────────────────────────────────────────

export type AgentTemplateCategory = 'general' | 'ecommerce'

export interface GeneralAgentPromptSections {
  subject?: string
  style?: string
  lighting?: string
  colors?: string
  composition?: string
  materials?: string
  mood?: string
  negativePrompt?: string
}

export interface GeneralAgentGenerateResult {
  prompt: string
  sections: GeneralAgentPromptSections
  templateCategory: 'general'
  rawText?: string
}

export type EcommercePlatform = 'amazon' | 'taobao' | 'jd' | 'pinduoduo' | 'temu' | 'shein'
export type EcommerceMarket = 'china' | 'usa' | 'europe' | 'japan' | 'southeast_asia'
export type EcommerceLanguage = 'zh' | 'en' | 'ja'
export type EcommerceAspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16'
export type EcommerceSetStructure = 'smart' | 'custom'

export interface EcommerceCustomCounts {
  whiteBg: number
  scene: number
  sellingPoint: number
  other: number
}

export interface EcommerceConfig {
  platform: EcommercePlatform
  market: EcommerceMarket
  language: EcommerceLanguage
  aspectRatio: EcommerceAspectRatio
  setStructure: EcommerceSetStructure
  customCounts?: EcommerceCustomCounts
  sellingPoints: string
}

export interface EcommercePromptDetails {
  subject?: string
  scene?: string
  composition?: string
  lighting?: string
  style?: string
  sellingPoint?: string
  parameters?: string
}

export interface EcommerceGenerateResult {
  prompts: Array<{
    type: string
    typeEn: string
    prompt: string
    aspectRatio: string
    details?: EcommercePromptDetails
  }>
  templateCategory: 'ecommerce'
  rawText?: string
}

export interface AgentGenerateResult {
  prompt: string
  templateCategory: AgentTemplateCategory
  agentResult?: GeneralAgentGenerateResult
  ecommercePrompts?: EcommerceGenerateResult
}

// ─── General Agent Result Parser ──────────────────────────────

type JsonObject = Record<string, unknown>

const SECTION_ALIASES: Record<keyof GeneralAgentPromptSections, readonly string[]> = {
  subject: ['subject', 'mainSubject', '主体', '主体描述', '画面主体'],
  style: ['style', 'visualStyle', '风格', '风格定义', '视觉风格'],
  lighting: ['lighting', 'light', '光影', '光影效果', '灯光'],
  colors: ['colors', 'colorPalette', 'palette', '色彩', '色彩方案', '配色'],
  composition: ['composition', 'layout', 'camera', '构图', '构图布局', '镜头'],
  materials: ['materials', 'textures', 'texture', '材质', '材质纹理', '质感'],
  mood: ['mood', 'atmosphere', 'emotion', '氛围', '氛围情绪', '情绪'],
  negativePrompt: ['negativePrompt', 'negative', 'parameters', '负面提示词', '反向提示词', '排除项'],
}

export function parseAgentGenerateResult(data: unknown): { ok: true; result: GeneralAgentGenerateResult } | { ok: false; error: string } {
  const rawText = getStringField(data, 'prompt')
  const agentResult = getObjectField(data, 'agentResult')

  if (agentResult) {
    const result = normalizeAgentResult(agentResult, '')
    if (result.prompt) {
      return { ok: true, result }
    }
  }

  if (!rawText) {
    return { ok: false, error: '生成结果为空' }
  }

  for (const candidate of getJsonCandidates(rawText)) {
    const parsed = parseJsonObject(candidate)
    if (!parsed) continue
    const result = normalizeAgentResult(parsed, '')
    if (result.prompt) {
      return { ok: true, result }
    }
  }

  return {
    ok: true,
    result: {
      prompt: rawText,
      sections: {},
      templateCategory: 'general',
      rawText,
    },
  }
}

function normalizeAgentResult(data: JsonObject, rawText: string): GeneralAgentGenerateResult {
  const prompt = getFirstString(data, ['prompt', 'finalPrompt', 'fullPrompt', '完整提示词', '最终提示词'])
  if (!prompt) {
    return { prompt: '', sections: {}, templateCategory: 'general' }
  }
  const sections = normalizeSections(data)
  return {
    prompt,
    sections,
    templateCategory: 'general',
    ...(rawText && rawText !== prompt ? { rawText } : {}),
  }
}

function normalizeSections(data: JsonObject): GeneralAgentPromptSections {
  const details = getObjectField(data, 'details')
  const sections = getObjectField(data, 'sections')
  const metadata = getObjectField(data, 'metadata')
  const sources = [sections, details, metadata, data].filter((s): s is JsonObject => s !== null)

  const normalized: GeneralAgentPromptSections = {}
  for (const [key, aliases] of Object.entries(SECTION_ALIASES) as Array<[keyof GeneralAgentPromptSections, readonly string[]]>) {
    const value = getAliasedString(sources, aliases)
    if (value) normalized[key] = value
  }
  return normalized
}

// ─── Ecommerce Result Parser ──────────────────────────────────

const DETAIL_ALIASES: Record<keyof EcommercePromptDetails, readonly string[]> = {
  subject: ['subject', 'mainSubject', 'product', '主体', '产品主体'],
  scene: ['scene', 'environment', 'background', '场景', '背景'],
  composition: ['composition', 'layout', 'camera', '构图', '镜头'],
  lighting: ['lighting', 'light', '光影', '灯光'],
  style: ['style', 'visualStyle', 'mood', '风格', '调性'],
  sellingPoint: ['sellingPoint', 'benefit', 'feature', '卖点', '核心卖点'],
  parameters: ['parameters', 'negativePrompt', 'params', '参数', '补充参数'],
}

export function parseEcommerceGenerateResult(data: unknown, fallbackAspectRatio: string): { ok: true; result: EcommerceGenerateResult } | { ok: false; error: string } {
  const rawText = getStringField(data, 'prompt')
  const ecommercePrompts = getObjectField(data, 'ecommercePrompts')

  if (ecommercePrompts) {
    const result = normalizeEcommerceResult(ecommercePrompts, fallbackAspectRatio)
    if (result.prompts.length > 0) return { ok: true, result }
  }

  if (rawText) {
    for (const candidate of getJsonCandidates(rawText)) {
      const parsed = parseJsonObject(candidate)
      if (!parsed) continue
      const result = normalizeEcommerceResult(parsed, fallbackAspectRatio)
      if (result.prompts.length > 0) return { ok: true, result }
    }
    return {
      ok: true,
      result: {
        prompts: [{
          type: '原始生成结果',
          typeEn: 'Raw Result',
          prompt: rawText,
          aspectRatio: fallbackAspectRatio,
        }],
        templateCategory: 'ecommerce',
        rawText,
      },
    }
  }

  return { ok: false, error: '生成结果为空' }
}

function normalizeEcommerceResult(data: JsonObject, fallbackAspectRatio: string): EcommerceGenerateResult {
  const prompts = Array.isArray(data.prompts)
    ? (data.prompts as unknown[]).flatMap(p => normalizeEcommercePrompt(p, fallbackAspectRatio))
    : []

  return {
    prompts,
    templateCategory: 'ecommerce',
    ...(typeof data.rawText === 'string' && data.rawText.trim() ? { rawText: data.rawText } : {}),
  }
}

function normalizeEcommercePrompt(data: unknown, fallbackAspectRatio: string): EcommerceGenerateResult['prompts'] {
  if (!isObject(data)) return []
  const prompt = typeof (data as JsonObject).prompt === 'string' ? ((data as JsonObject).prompt as string).trim() : ''
  if (!prompt) return []

  const d = data as JsonObject
  const normalized: EcommerceGenerateResult['prompts'][number] = {
    type: valueOrDefault(d.type, '综合'),
    typeEn: valueOrDefault(d.typeEn, 'General'),
    prompt,
    aspectRatio: valueOrDefault(d.aspectRatio, fallbackAspectRatio),
  }

  // Normalize details
  const detailsObj = getObjectField(d, 'details') || getObjectField(d, 'sections') || getObjectField(d, 'metadata')
  if (detailsObj) {
    const details: EcommercePromptDetails = {}
    for (const [key, aliases] of Object.entries(DETAIL_ALIASES) as Array<[keyof EcommercePromptDetails, readonly string[]]>) {
      const val = getAliasedString([detailsObj], aliases)
      if (val) details[key] = val
    }
    if (Object.keys(details).length > 0) normalized.details = details
  }

  return [normalized]
}

// ─── Shared Utilities ─────────────────────────────────────────

function getFirstString(data: JsonObject, fields: readonly string[]): string {
  for (const field of fields) {
    const value = data[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function getAliasedString(sources: JsonObject[], aliases: readonly string[]): string {
  for (const source of sources) {
    for (const alias of aliases) {
      const value = source[alias]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return ''
}

function getJsonCandidates(text: string): string[] {
  const fenced = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), match => match[1].trim())
  return [text.trim(), ...fenced, ...extractJsonObjects(text)].filter(Boolean)
}

function extractJsonObjects(text: string): string[] {
  const objects: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) { escaped = false }
      else if (char === '\\') { escaped = true }
      else if (char === '"') { inString = false }
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === '{') { if (depth === 0) start = i; depth++; continue }
    if (char === '}' && depth > 0) {
      depth--
      if (depth === 0 && start >= 0) { objects.push(text.slice(start, i + 1)); start = -1 }
    }
  }
  return objects
}

function parseJsonObject(text: string): JsonObject | null {
  try {
    const parsed = JSON.parse(text)
    return isObject(parsed) ? parsed : null
  } catch { return null }
}

function getObjectField(data: unknown, field: string): JsonObject | null {
  if (!isObject(data)) return null
  const value = (data as JsonObject)[field]
  return isObject(value) ? value : null
}

function getStringField(data: unknown, field: string): string {
  if (!isObject(data)) return ''
  const value = (data as JsonObject)[field]
  return typeof value === 'string' ? value.trim() : ''
}

function valueOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
