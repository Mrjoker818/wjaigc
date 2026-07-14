export type ChatAgentToolChoice = 'required' | 'auto';

export function resolveChatAgentToolChoice(
  isAgentMode: boolean,
  completedIterations: number,
): ChatAgentToolChoice {
  return isAgentMode && completedIterations === 0 ? 'required' : 'auto';
}
