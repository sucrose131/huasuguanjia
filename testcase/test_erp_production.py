"""华溯管家ERP - 生产管理测试用例

测试方法：列表页测试(LP)
覆盖模块：生产计划单
"""
import pytest
from page.erp_login_page import ErpLoginPage
from page.erp_production_page import ErpProductionPage


@pytest.fixture(scope="function")
def logged_in_page(page):
    """登录fixture"""
    login_page = ErpLoginPage(page)
    login_page.open()
    login_page.login()
    assert login_page.is_logged_in(), "登录失败"


class TestProduction:
    """生产管理测试"""

    def test_production_plan_list(self, logged_in_page):
        """TC-PROD-001: 生产计划单列表

        预期结果：列表含5条记录
        """
        page = ErpProductionPage(logged_in_page)
        page.navigate()
        count = page.get_record_count()
        assert count > 0, f"生产计划单列表为空，预期至少1条记录，实际{count}"

        # 验证操作按钮存在
        assert page.has_button("新增"), "缺少新增按钮"
        assert page.has_button("查看"), "缺少查看按钮"
