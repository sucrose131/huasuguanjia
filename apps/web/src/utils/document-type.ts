export function workflowDocumentType(group: string, resource: string, row?: Record<string, any>) {
  const key = `${group}/${resource}`;
  const mapping: Record<string, string> = {
    'production/plans': 'production_plan',
    'production/shortages': 'production_shortage',
    'production/outputs': 'production_material_output',
    'production/inputs': 'production_input',
    'sales/orders':
      Number(row?.propertyType ?? row?.so_property_type) === 2
        ? 'discount_sale_order'
        : 'sales_order',
    'sales/discount-orders': 'discount_sale_order',
    'sales/outputs':
      Number(row?.propertyType ?? row?.so_property_type) === 2
        ? 'discount_sale_output'
        : 'sales_output',
    'sales/returns': 'sales_return',
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
    checks: 'inventory_check',
    losses:
      Number(row?.businessKind ?? row?.business_kind) === 1
        ? 'inventory_shortage'
        : 'inventory_loss',
    'loss-outputs': 'inventory_loss_output',
    overflows: 'inventory_overflow',
    'overflow-inputs': 'inventory_overflow_input',
  };
  return mapping[resource] ?? '';
}
