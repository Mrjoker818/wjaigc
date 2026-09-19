import type { CanvasShareErrorCode } from './types';

interface CanvasShareErrorDefinition {
  message: string;
  status: number;
}

const CANVAS_SHARE_ERRORS: Readonly<Record<CanvasShareErrorCode, CanvasShareErrorDefinition>> = {
  CANVAS_SHARE_DISABLED: {
    status: 503,
    message: '只读画布分享功能暂不可用',
  },
  CANVAS_SHARE_UNAUTHORIZED: {
    status: 403,
    message: '无权访问此画布分享',
  },
  CANVAS_SHARE_NOT_FOUND: {
    status: 404,
    message: '画布分享不存在或已失效',
  },
  CANVAS_SHARE_MEDIA_NOT_READY: {
    status: 409,
    message: '画布中有媒体尚未就绪',
  },
  CANVAS_SHARE_PROJECT_CONFLICT: {
    status: 409,
    message: '画布项目已发生变化，请刷新后重试',
  },
  CANVAS_SHARE_UNSUPPORTED_ELEMENT: {
    status: 422,
    message: '画布包含暂不支持分享的内容',
  },
  CANVAS_SHARE_DOWNLOAD_DISABLED: {
    status: 403,
    message: '此画布分享未开启下载',
  },
  CANVAS_SHARE_POLICY_CONFLICT: {
    status: 409,
    message: '画布分享策略已发生变化，请刷新后重试',
  },
  CANVAS_SHARE_MEDIA_UNAVAILABLE: {
    status: 410,
    message: '此分享内容暂不可用',
  },
};

export class CanvasShareError extends Error {
  readonly code: CanvasShareErrorCode;
  readonly status: number;

  constructor(code: CanvasShareErrorCode) {
    const definition = CANVAS_SHARE_ERRORS[code];
    super(definition.message);
    this.name = 'CanvasShareError';
    this.code = code;
    this.status = definition.status;
  }

  toJSON(): { code: CanvasShareErrorCode; message: string; status: number } {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
    };
  }
}
