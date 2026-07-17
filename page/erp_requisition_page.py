"""华溯管家ERP - 领用管理页面对象"""
from config.global_cfg import GlobalCfg


class ErpRequisitionPage:
    """领用申请单页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到领用申请单列表"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/requisition/apply")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def get_record_count(self):
        """获取领用申请单数量"""
        total_text = self.page.locator(".el-pagination__total").text_content()
        if total_text:
            import re
            match = re.search(r"共\s*(\d+)\s*条", total_text)
            if match:
                return int(match.group(1))
        return 0

    def has_new_button(self):
        """检查是否有新增按钮"""
        return self.page.get_by_role("button", name="新增").count() > 0

    def get_sub_menu_items(self):
        """获取领用管理子菜单"""
        items = self.page.locator("aside li.el-menu-item").all_text_contents()
        return [i.strip() for i in items if i.strip()]


class ErpTodoPage:
    """待办事项页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到待办事项"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/todo")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def get_todo_count(self):
        """获取待办事项数量"""
        total_text = self.page.locator(".el-pagination__total").text_content()
        if total_text:
            import re
            match = re.search(r"共\s*(\d+)\s*条", total_text)
            if match:
                return int(match.group(1))
        return 0

    def has_action_button(self):
        """检查是否有'去处理'按钮"""
        return self.page.get_by_role("button", name="去处理").count() > 0

    def click_go_handle(self, row_index=0):
        """点击'去处理'按钮"""
        buttons = self.page.locator("button:has-text('去处理')")
        if buttons.count() > row_index:
            buttons.nth(row_index).click()
        self.page.wait_for_timeout(2000)

    def search_todo(self, keyword):
        """搜索待办"""
        search_input = self.page.locator("input[placeholder*='搜索'], input[placeholder*='请输入']").first
        search_input.fill(keyword)
        self.page.wait_for_timeout(300)
        self.page.get_by_role("button", name="查询").click()
        self.page.wait_for_timeout(1500)


class ErpReportPage:
    """报表中心页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到报表中心"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/report")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def get_report_menu_count(self):
        """获取报表子菜单数量"""
        # 从侧边栏获取报表下的子菜单
        report_items = self.page.locator("aside li.el-menu-item, aside .el-sub-menu.is-opened li.el-menu-item")
        return report_items.count()
