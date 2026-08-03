export interface AuthUser {
  id: string;
  username: string;
  orgId: string | null;
  deptId: string | null;
  permissions: string[];
}
export interface AuthRequest {
  user: AuthUser;
  headers: Record<string, string | undefined>;
}
