/**
 * Error Handler
 * 
 * Global error handling and user-friendly error messages.
 */

import type { ErrorResponse } from '../types';

// Korean error messages
export const ERROR_MESSAGES = {
  COMPANY_NOT_FOUND: '회사를 찾을 수 없습니다.',
  API_ERROR: 'API 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
  NETWORK_ERROR: '네트워크 연결을 확인해주세요.',
  INVALID_QUERY: '검색어를 입력해주세요.',
  DATA_UNAVAILABLE: '데이터를 불러올 수 없습니다.',
  CALCULATION_ERROR: '재무비율 계산 중 오류가 발생했습니다.',
  RATE_LIMIT: 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
  INTERNAL_ERROR: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
  VALIDATION_ERROR: '입력값이 올바르지 않습니다.',
  NOT_FOUND: '요청하신 리소스를 찾을 수 없습니다.'
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

/**
 * Application Error class
 */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AppError';
  }

  toResponse(): ErrorResponse {
    return {
      error: this.code,
      message: this.message,
      code: this.code
    };
  }
}

/**
 * Create error response
 */
export function createErrorResponse(
  code: ErrorCode,
  statusCode: number = 500
): ErrorResponse {
  return {
    error: code,
    message: ERROR_MESSAGES[code],
    code
  };
}

/**
 * Handle unknown errors
 */
export function handleError(error: unknown): ErrorResponse {
  if (error instanceof AppError) {
    return error.toResponse();
  }

  if (error instanceof Error) {
    console.error('Unhandled error:', error);
    return {
      error: 'INTERNAL_ERROR',
      message: ERROR_MESSAGES.INTERNAL_ERROR,
      code: error.message
    };
  }

  return {
    error: 'INTERNAL_ERROR',
    message: ERROR_MESSAGES.INTERNAL_ERROR
  };
}

/**
 * Partial data response for graceful degradation
 */
export interface PartialDataResponse<T> {
  data: Partial<T>;
  errors: Array<{
    field: string;
    message: string;
  }>;
  isPartial: boolean;
}

export function createPartialResponse<T>(
  data: Partial<T>,
  errors: Array<{ field: string; message: string }>
): PartialDataResponse<T> {
  return {
    data,
    errors,
    isPartial: errors.length > 0
  };
}
