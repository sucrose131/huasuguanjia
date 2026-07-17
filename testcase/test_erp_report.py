"""华溯管家ERP - 报表中心测试用例

测试方法：列表页测试(LP)
覆盖模块：报表中心
"""
import pytest
from page.erp_login_page import ErpLoginPage
from page.erp_requisition_page import ErpReportPage


@pytest.fixture(scope="function")
def logged_in_page(page):
    """登录fixture"""
    login_page = ErpLoginPage(page)
    login_page.open()
    login_page.login()
    assert login_page.is_logged_in(), "登录失败"


class TestReportCenter:
    """报表中心测试"""

    def test_report_menu_structure(self, logged_in_page):
        """TC-RPT-001: 报表中心菜单结构

        预期结果：8个入口完整
        """
        page = ErpReportPage(logged_in_page)
        page.navigate()
        count = page.get_report_menu_count()
        assert count >= 8, f"报表中心子菜单数量不足，预期至少8个，实际{count}"
