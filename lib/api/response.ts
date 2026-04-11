import { getRequestId } from '@/lib/telemetry/requestId';

export interface ApiResponse<T = unknown> {
  requestId: string;
  ok: boolean;
  data?: T;
  error?: string;
}

export function success<T>(data: T): ApiResponse<T> {
  return {
    requestId: getRequestId(),
    ok: true,
    data,
  };
}

export function error<T = unknown>(message: string, data?: T): ApiResponse<T> {
  return {
    requestId: getRequestId(),
    ok: false,
    error: message,
    ...(data !== undefined ? { data } : {}),
  };
}
