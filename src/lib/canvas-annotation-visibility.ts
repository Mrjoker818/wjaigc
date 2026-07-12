type AnnotationBubbleState = {
  status: 'pending' | 'running' | 'done' | 'failed';
  chatExpanded?: boolean;
};

export function shouldShowAnnotationBubble({ status, chatExpanded }: AnnotationBubbleState): boolean {
  return Boolean(chatExpanded) || status === 'running' || status === 'pending' || status === 'done' || status === 'failed';
}
