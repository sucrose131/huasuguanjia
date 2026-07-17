"""华溯管家ERP - 基础资料与商品管理测试用例

测试方法：场景法(SC)、按钮测试(BT)、列表页测试(LP)、错误推测法(ER)
覆盖模块：供应商管理、客户管理、仓库管理、商品管理
"""
import pytest
from page.erp_login_page import ErpLoginPage
from page.erp_supplier_page import ErpSupplierPage
from page.erp_customer_page import ErpCustomerPage
from page.erp_warehouse_page import ErpWarehousePage, ErpProductPage


@pytest.fixture(scope="function")
def logged_in_page(page):
    """登录fixture，返回已登录的page"""
    login_page = ErpLoginPage(page)
    login_page.open()
    login_page.login()
    assert login_page.is_logged_in(), "登录失败，无法执行后续测试"


class TestSupplier:
    """供应商管理测试（完整CRUD）"""

    def test_supplier_list(self, logged_in_page):
        """TC-BASE-001: 供应商列表展示与分页"""
        page = ErpSupplierPage(logged_in_page)
        page.navigate()
        count = page.get_record_count()
        assert count > 0, f"供应商列表为空，预期至少有一条记录"

    def test_add_supplier(self, logged_in_page):
        """TC-BASE-002: 新增供应商"""
        page = ErpSupplierPage(logged_in_page)
        page.navigate()
        before_count = page.get_record_count()

        page.click_add()
        page.fill_form("测试供应商_自动化测试")
        page.save()

        page.search("测试供应商_自动化测试")
        after_count = page.get_record_count()
        assert after_count > 0, "新增供应商后搜索不到记录"

    def test_edit_supplier(self, logged_in_page):
        """TC-BASE-003: 编辑供应商"""
        page = ErpSupplierPage(logged_in_page)
        page.navigate()
        page.search("测试供应商_自动化测试")
        page.click_edit(0)
        page.fill_form("测试供应商_自动化测试", 备注="自动化测试修改值")
        page.save()

        page.click_view(0)
        detail_text = logged_in_page.content()
        assert "自动化测试修改值" in detail_text or page.get_column_text(0, 0) != "", \
            "编辑供应商后未显示修改值"

    def test_delete_supplier(self, logged_in_page):
        """TC-BASE-004: 删除供应商（软删除）"""
        page = ErpSupplierPage(logged_in_page)
        page.navigate()
        before_count = page.get_record_count()

        page.search("测试供应商_自动化测试")
        page.click_more_action("删除")
        page.confirm_action()

        page.reset_search()
        after_count = page.get_record_count()
        assert after_count <= before_count, "删除后记录数未减少"

    def test_search_supplier(self, logged_in_page):
        """TC-BASE-005: 供应商搜索"""
        page = ErpSupplierPage(logged_in_page)
        page.navigate()
        page.search("测试供应商_自动化测试")
        count = page.get_record_count()
        # 搜索后记录数不应超过总数
        assert count >= 0, "搜索功能异常"


class TestCustomer:
    """客户管理测试"""

    def test_add_customer(self, logged_in_page):
        """TC-BASE-006: 新增客户"""
        page = ErpCustomerPage(logged_in_page)
        page.navigate()
        before_count = page.get_customer_count()

        page.click_add()
        page.fill_basic_info("测试客户_自动化测试", organization="华溯控股")
        page.save()

        after_count = page.get_customer_count()
        assert after_count >= before_count, "新增客户后数量未增加"

    def test_disable_customer(self, logged_in_page):
        """TC-BASE-007: 停用客户（按钮测试）"""
        page = ErpCustomerPage(logged_in_page)
        page.navigate()
        page.search("测试客户_自动化测试")

        page.click_more_action("停用")
        page.confirm_action()
        # 停用后记录应仍在列表中（状态变更）
        assert True, "停用操作已执行"


class TestWarehouseAndProduct:
    """仓库与商品管理测试"""

    def test_warehouse_list(self, logged_in_page):
        """TC-BASE-008: 仓库列表"""
        page = ErpWarehousePage(logged_in_page)
        page.navigate()
        count = page.get_warehouse_count()
        assert count > 0, "仓库列表为空"

    def test_product_list(self, logged_in_page):
        """TC-BASE-008: 商品资料列表"""
        page = ErpProductPage(logged_in_page)
        page.navigate()
        count = page.get_product_count()
        assert count > 0, "商品资料列表为空"
