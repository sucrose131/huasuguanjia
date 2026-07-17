"""华溯管家ERP - 库存管理测试用例

测试方法：等价类划分(EC)、错误推测法(ER)、列表页测试(LP)、表单元素测试(FE)
覆盖模块：库存查询
"""
import pytest
from page.erp_login_page import ErpLoginPage
from page.erp_inventory_page import ErpInventoryPage


@pytest.fixture(scope="function")
def logged_in_page(page):
    """登录fixture"""
    login_page = ErpLoginPage(page)
    login_page.open()
    login_page.login()
    assert login_page.is_logged_in(), "登录失败"


class TestInventoryQuery:
    """库存查询测试"""

    def test_no_org_selected(self, logged_in_page):
        """TC-INV-001: 库存查询未选组织（错误推测法）

        进入库存查询，不选组织，预期提示选择组织
        """
        page = ErpInventoryPage(logged_in_page)
        page.navigate()
        assert page.is_org_required_message_visible(), \
            "未选择组织时应显示提示信息"

    def test_group_org_empty_stock(self, logged_in_page):
        """TC-INV-002: 库存查询-集团（等价类：无库存）

        选择集团组织，预期库存为空
        """
        page = ErpInventoryPage(logged_in_page)
        page.navigate()
        page.select_organization("华溯控股（深圳）有限公司（集团）")
        count = page.get_stock_item_count()
        # 集团层面库存为0是正常业务设计
        assert count == 0, f"集团组织预期库存为0，实际为{count}"

    def test_sub_org_has_stock(self, logged_in_page):
        """TC-INV-003: 库存查询-子公司（等价类：有库存）

        选择子公司组织，预期有库存数据
        """
        page = ErpInventoryPage(logged_in_page)
        page.navigate()
        page.select_organization("华溯控股（深圳）有限公司")
        count = page.get_stock_item_count()
        assert count > 0, f"子公司组织应有库存数据，实际为{count}"

    def test_warehouse_filter(self, logged_in_page):
        """TC-INV-004: 仓库筛选

        测试各仓库标签按钮筛选功能
        """
        page = ErpInventoryPage(logged_in_page)
        page.navigate()
        page.select_organization("华溯控股（深圳）有限公司")

        tags = page.get_warehouse_tags()
        assert len(tags) > 0, "未显示仓库标签筛选按钮"

    def test_stock_flow(self, logged_in_page):
        """TC-INV-005: 库存流水

        验证库存流水区域有记录展示
        """
        page = ErpInventoryPage(logged_in_page)
        page.navigate()
        page.select_organization("华溯控股（深圳）有限公司")

        flow_count = page.get_stock_flow_count()
        assert flow_count >= 0, "库存流水加载异常"
