export type GatewayMediaType = 'image' | 'video';

export type GatewayAdmissionStatus = 'reserved' | 'admitted' | 'rejected';

export interface GatewayKeyRecord {
  id: string;
  userId: string;
  keyHash: string;
  keyPrefix: string;
  label: string;
  requestsPerMinute: number;
  dailyQuota: number;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface GatewayRequestRecord {
  id: string;
  gatewayKeyId: string;
  userId: string;
  idempotencyKey: string;
  requestDigest: string;
  mediaType: GatewayMediaType;
  admissionStatus: GatewayAdmissionStatus;
  taskIds: string[];
  rejectionCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GatewayErrorCode =
  | 'GATEWAY_DISABLED'
  | 'GATEWAY_AUTH_REQUIRED'
  | 'GATEWAY_KEY_INVALID'
  | 'GATEWAY_RATE_LIMITED'
  | 'GATEWAY_DAILY_QUOTA_EXCEEDED'
  | 'GATEWAY_IDEMPOTENCY_REQUIRED'
  | 'GATEWAY_IDEMPOTENCY_CONFLICT'
  | 'GATEWAY_BODY_TOO_LARGE'
  | 'GATEWAY_INVALID_REQUEST'
  | 'GATEWAY_TASK_NOT_FOUND'
  | 'GATEWAY_INTERNAL_UNAVAILABLE';

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    readonly status: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}
