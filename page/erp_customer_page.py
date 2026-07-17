"""华溯管家ERP - 客户管理页面对象"""
from config.global_cfg import GlobalCfg


class ErpCustomerPage:
    """客户管理页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到客户列表页面"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/data/customer")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def click_add(self):
        """点击新增客户按钮"""
        self.page.get_by_role("button", name="新增").click()
        self.page.wait_for_timeout(1000)

    def fill_basic_info(self, name, organization=None):
        """填写客户基本信息"""
        self.page.get_by_label("名称").fill(name)
        self.page.wait_for_timeout(300)
        if organization:
            self.page.locator("input[placeholder*='组织']").click()
            self.page.wait_for_timeout(500)
            self.page.get_by_text(organization).click()
            self.page.wait_for_timeout(500)

    def save(self):
        """保存客户"""
        self.page.get_by_role("button", name="保存").click()
        self.page.wait_for_timeout(2000)

    def get_customer_count(self):
        """获取客户数量"""
        total_text = self.page.locator(".el-pagination__total").text_content()
        if total_text:
            import re
            match = re.search(r"共\s*(\d+)\s*条", total_text)
            if match:
                return int(match.group(1))
        return 0

    def click_more_action(self, action_name, row_index=0):
        """点击更多菜单中的操作"""
        more_buttons = self.page.locator("button:has-text('更多')")
        if more_buttons.count() > row_index:
            more_buttons.nth(row_index).click()
            self.page.wait_for_timeout(500)
        self.page.get_by_text(action_name, exact=True).click()
        self.page.wait_for_timeout(1000)

    def confirm_action(self):
        """确认弹窗操作"""
        self.page.get_by_role("button", name="确定").click()
        self.page.wait_for_timeout(1500)

    def search(self, keyword):
        """搜索客户"""
        search_input = self.page.locator("input[placeholder*='搜索'], input[placeholder*='请输入']").first
        search_input.fill(keyword)
        self.page.wait_for_timeout(300)
        self.page.get_by_role("button", name="查询").click()
        self.page.wait_for_timeout(1500)
