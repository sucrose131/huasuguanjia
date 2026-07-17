"""华溯管家ERP - 登录认证测试用例

测试方法：场景法(SC)
优先级：P0
"""
import pytest
from page.erp_login_page import ErpLoginPage


class TestErpLogin:
    """登录认证测试"""

    def test_valid_login(self, page):
        """TC-LOGIN-001: 有效账号登录

        测试步骤：
        1. 输入用户名 admin
        2. 输入密码 admin123
        3. 点击登录按钮

        预期结果：登录成功，跳转至 /dashboard/overview，左侧菜单完整展示 9 个模块
        """
        login_page = ErpLoginPage(page)
        login_page.open()
        login_page.login()

        # 验证登录成功
        assert login_page.is_logged_in(), "登录后未进入工作台页面"

        # 验证菜单模块
        modules = login_page.get_menu_modules()
        assert len(modules) >= 9, f"菜单模块数量不足，实际: {len(modules)}，模块列表: {modules}"
