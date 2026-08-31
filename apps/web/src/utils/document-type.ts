export function workflowDocumentType(group: string, resource: string, row?: Record<string, any>) {
  const key = `${group}/${resource}`;
  const mapping: Record<string, string> = {
    'production/plans': 'production_plan',
    'production/boms': 'production_bom',
    'production/shortages': 'production_shortage',
    'production/outputs': 'production_material_output',
    'production/inputs': 'production_input',
    'sales/orders': 'sales_order',
    'sales/discount-orders': 'sales_order',
    'sales/outputs': 'sales_output',
    'sales/returns': 'sales_return',
    'sales/services': 'sales_service',
    'sales/payments': 'sales_payment',
    'sales/refunds': 'sales_refund',
    'requisitions/applications': 'requisition_application',
    'requisitions/outputs': 'requisition_output',
    'requisitions/returns': 'requisition_return',
  };
  return mapping[key] ?? '';
}

export function purchaseDocumentType(resource: string) {
  const mapping: Record<string, string> = {
    applications: 'purchase_application',
    orders: 'purchase_order',
    receipts: 'purchase_receipt',
    returns: 'purchase_return',
    payments: 'purchase_payment',
    refunds: 'purchase_refund',
  };
  return mapping[resource] ?? '';
}

export function inventoryDocumentType(resource: string, row?: Record<string, any>) {
  const mapping: Record<string, string> = {
    transfers: 'inventory_transfer',
    adjustments: 'inventory_adjust',
    checks: 'inventory_check',
    losses: 'inventory_loss',
    'loss-outputs': 'inventory_loss_output',
    overflows: 'inventory_overflow',
    'overflow-inputs': 'inventory_overflow',
  };
  return mapping[resource] ?? '';
}
