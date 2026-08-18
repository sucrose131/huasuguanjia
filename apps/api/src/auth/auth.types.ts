export interface AuthUser {
  id: string;
  username: string;
  orgId: string | null;
  deptId: string | null;
  staffId?: string | null;
  positionId?: string | null;
  positionName?: string | null;
  currentOrgId?: string;
  currentOrgName?: string;
  authorizedOrganizations?: Array<{ id: string; name: string }>;
  isSuperAdmin?: boolean;
  permissions: string[];
}
export interface AuthRequest {
  user: AuthUser;
  headers: Record<string, string | undefined>;
}
