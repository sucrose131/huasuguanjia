export interface PageRequest {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export interface PageResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export interface WriteResponse {
  id: string | number;
  message: string;
  businessNo?: string;
}
