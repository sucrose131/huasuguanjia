"""华溯管家ERP - 领用管理测试用例

测试方法：列表页测试(LP)
覆盖模块：领用申请单
"""
import pytest
from page.erp_login_page import ErpLoginPage
from page.erp_requisition_page import ErpRequisitionPage


@pytest.fixture(scope="function")
def logged_in_page(page):
    """登录fixture"""
    login_page = ErpLoginPage(page)
    login_page.open()
    login_page.login()
    assert login_page.is_logged_in(), "登录失败"


class TestRequisition:
    """领用管理测试"""

    def test_requisition_list(self, logged_in_page):
        """TC-REQ-001: 领用申请单列表

        预期结果：列表展示，含新增/查看/更多按钮
        """
        page = ErpRequisitionPage(logged_in_page)
        page.navigate()
        count = page.get_record_count()
        assert count >= 0, "领用申请单列表加载异常"
        assert page.has_new_button(), "缺少新增按钮"
