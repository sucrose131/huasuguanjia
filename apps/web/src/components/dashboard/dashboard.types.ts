import type { Component } from 'vue';

export interface DashboardTrendItem {
  date: string;
  sales: number | null;
  purchase: number | null;
}

export interface DashboardTodoItem {
  id: string;
  sourceId: string;
  docNo: string;
  docType: string;
  businessModule: string;
  counterparty?: string;
  date: string;
  amount?: number | null;
  creator?: string;
  status: string;
  route?: string;
  createdAt?: string;
}

export interface DashboardMessageItem {
  id: string;
  title: string;
  content: string;
  category: string;
  isRead: number;
  amount?: number | null;
  createdAt?: string;
}

export interface DashboardOverviewData {
  salesAmount: number | null;
  purchaseAmount: number | null;
  inventoryValue: number | null;
  pendingCount: number;
  lowStockCount: number;
  inventoryCount: number;
  healthScore: number;
  trend: DashboardTrendItem[];
  todos: DashboardTodoItem[];
  messages: DashboardMessageItem[];
  unreadCount: number;
  lowStockItem: null | {
    name: string;
    stock: number;
    safetyStock: number;
  };
  modules?: DashboardModuleAccess;
  widgets?: DashboardWidgetAccess;
}

export interface DashboardModuleAccess {
  sales: boolean;
  purchase: boolean;
  inventory: boolean;
  production: boolean;
  todos: boolean;
  messages: boolean;
  shortcuts: boolean;
}

export interface DashboardWidgetAccess {
  salesAmount: boolean;
  purchaseAmount: boolean;
  inventoryValue: boolean;
  pendingCount: boolean;
  businessTrend: boolean;
  inventoryHealth: boolean;
  todoPreview: boolean;
  quickActions: boolean;
  messageSummary: boolean;
}

export interface DashboardShortcut {
  key: string;
  title: string;
  description: string;
  path: string;
  create?: boolean;
  pagePermission: string;
  actionPermission?: string;
  icon: Component;
}
