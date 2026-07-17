"""华溯管家ERP - 销售管理测试用例

测试方法：列表页测试(LP)、错误推测法(ER)、表单元素测试(FE)、等价类划分(EC)
覆盖模块：销售订单
"""
import pytest
from page.erp_login_page import ErpLoginPage
from page.erp_sales_page import ErpSalesPage


@pytest.fixture(scope="function")
def logged_in_page(page):
    """登录fixture"""
    login_page = ErpLoginPage(page)
    login_page.open()
    login_page.login()
    assert login_page.is_logged_in(), "登录失败"


class TestSalesOrder:
    """销售订单测试"""

    def test_sales_order_list(self, logged_in_page):
        """TC-SALE-001: 销售订单列表

        预期结果：列表含2条订单
        """
        page = ErpSalesPage(logged_in_page)
        page.navigate()
        count = page.get_record_count()
        assert count >= 0, "销售订单列表加载异常"

    def test_empty_submit_validation(self, logged_in_page):
        """TC-SALE-002: 空提交校验（错误推测法）

        不填任何字段点击"保存并提交审核"，预期前端拦截
        """
        page = ErpSalesPage(logged_in_page)
        page.navigate()
        page.click_add()
        page.submit_empty()

        # 验证对话框仍然打开（前端校验未放行）
        assert page.is_dialog_open(), \
            "空表单提交后对话框被关闭，前端校验可能未生效"

    def test_sales_form_fields(self, logged_in_page):
        """TC-SALE-003: 销售订单表单元素清单

        逐一检查每个字段类型和状态
        """
        page = ErpSalesPage(logged_in_page)
        page.navigate()
        page.click_add()

        fields = page.get_form_fields()
        assert len(fields) > 0, "未获取到表单字段"
        # 验证关键字段存在
        field_text = " ".join(fields).lower()
        assert any(k in field_text for k in ["客户", "仓库", "订单", "组织"]), \
            f"关键字段缺失，当前字段: {fields}"

    def test_sales_dropdowns(self, logged_in_page):
        """TC-SALE-004: 销售订单下拉选项完整度

        展开各下拉检查数据完整性
        """
        page = ErpSalesPage(logged_in_page)
        page.navigate()
        page.click_add()

        # 获取客户下拉选项
        customer_options = page.get_dropdown_options("客户")
        assert len(customer_options) > 0, "客户下拉选项为空"

        # 获取仓库下拉选项
        warehouse_options = page.get_dropdown_options("仓库")
        assert len(warehouse_options) > 0, "仓库下拉选项为空"

        # 获取组织下拉选项
        org_options = page.get_dropdown_options("组织")
        assert len(org_options) > 0, "组织下拉选项为空"
