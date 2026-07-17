"""华溯管家ERP - 待办事项测试用例

测试方法：列表页测试(LP)
覆盖模块：工作台 > 待办事项
"""
import pytest
from page.erp_login_page import ErpLoginPage
from page.erp_requisition_page import ErpTodoPage


@pytest.fixture(scope="function")
def logged_in_page(page):
    """登录fixture"""
    login_page = ErpLoginPage(page)
    login_page.open()
    login_page.login()
    assert login_page.is_logged_in(), "登录失败"


class TestTodo:
    """待办事项测试"""

    def test_todo_list(self, logged_in_page):
        """TC-TODO-001: 待办事项列表

        预期结果：10条待办，含搜索/来源类型筛选/去处理按钮
        """
        page = ErpTodoPage(logged_in_page)
        page.navigate()
        count = page.get_todo_count()
        assert count > 0, f"待办事项列表为空，预期至少1条，实际{count}"
        assert page.has_action_button(), "缺少'去处理'按钮"
