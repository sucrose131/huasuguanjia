import { describe, expect, it } from 'vitest';
import { OA_FORM_MAPPINGS } from './form-mapping.constants';

describe('OA_FORM_MAPPINGS', () => {
  it('包含当前确认的 11 张业务表单', () => {
    expect(Object.keys(OA_FORM_MAPPINGS)).toHaveLength(11);
  });

  it('每张表单的业务类型、标识和字段配置完整', () => {
    for (const [businessType, mapping] of Object.entries(OA_FORM_MAPPINGS)) {
      expect(mapping.businessType).toBe(businessType);
      expect(mapping.formKey).toMatch(/^AAC\d+_NFORM_\d+$/);
      expect(mapping.formId).toMatch(/^\d+$/);
      expect(Object.keys(mapping.fields).length).toBeGreaterThan(0);
      for (const item of Object.values(mapping.fields)) {
        expect(item.componentType).toMatch(/^Fin/);
        expect(item.uniqueName).toMatch(/^[a-z0-9]+$/);
        expect(typeof item.child).toBe('boolean');
      }
    }
  });

  it('使用最新的人员选择控件', () => {
    expect(OA_FORM_MAPPINGS.requisition_application.fields.applicant).toEqual({
      componentType: 'FinPeopleSelect',
      uniqueName: '51c0cg9xhbzv',
      child: false,
    });
    expect(OA_FORM_MAPPINGS.inventory_transfer.fields.sender.uniqueName).toBe('lryp0thutg9z');
    expect(OA_FORM_MAPPINGS.inventory_transfer.fields.receiver.uniqueName).toBe('x1lff5wg5wzl');
  });

  it('领用附件包含图片和签名时统一使用附件控件', () => {
    expect(OA_FORM_MAPPINGS.requisition_application.fields.attachments).toEqual({
      componentType: 'FinUpload',
      uniqueName: '9d9x9fg3tmg4',
      child: false,
    });
    expect('images' in OA_FORM_MAPPINGS.requisition_application.fields).toBe(false);
  });
});
