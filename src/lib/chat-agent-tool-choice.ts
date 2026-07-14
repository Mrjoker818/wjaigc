export type ChatToolChoice = 'auto' | 'required';

/**
 * Agent needs one initial tool call to act, then an automatic follow-up turn
 * so the model can summarize the tool result instead of repeatedly invoking tools.
 */
export function getAgentToolChoice(isAgentMode: boolean, iteration: number): ChatToolChoice {
  return isAgentMode && iteration === 1 ? 'required' : 'auto';
}
