"""华溯管家ERP - 供应商管理页面对象"""
from config.global_cfg import GlobalCfg


class ErpSupplierPage:
    """供应商管理页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到供应商列表页面"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/data/supplier")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def get_record_count(self):
        """获取当前列表记录数"""
        # 尝试从分页信息获取总数
        total_text = self.page.locator(".el-pagination__total").text_content()
        if total_text:
            import re
            match = re.search(r"共\s*(\d+)\s*条", total_text)
            if match:
                return int(match.group(1))
        return 0

    def click_add(self):
        """点击新增按钮"""
        self.page.get_by_role("button", name="新增").click()
        self.page.wait_for_timeout(1000)

    def fill_form(self, name, **kwargs):
        """填写供应商表单"""
        self.page.get_by_label("名称").fill(name)
        self.page.wait_for_timeout(300)
        if kwargs:
            for field, value in kwargs.items():
                try:
                    self.page.get_by_label(field).fill(str(value))
                except Exception:
                    pass
                self.page.wait_for_timeout(200)

    def save(self):
        """点击保存"""
        self.page.get_by_role("button", name="保存").click()
        self.page.wait_for_timeout(2000)

    def search(self, keyword):
        """搜索供应商"""
        search_input = self.page.locator("input[placeholder*='搜索'], input[placeholder*='请输入']").first
        search_input.fill(keyword)
        self.page.wait_for_timeout(300)
        self.page.get_by_role("button", name="查询").click()
        self.page.wait_for_timeout(1500)

    def reset_search(self):
        """重置搜索条件"""
        self.page.get_by_role("button", name="重置").click()
        self.page.wait_for_timeout(1000)

    def click_view(self, row_index=0):
        """点击查看按钮"""
        buttons = self.page.locator("button:has-text('查看')")
        if buttons.count() > row_index:
            buttons.nth(row_index).click()
        self.page.wait_for_timeout(1500)

    def click_edit(self, row_index=0):
        """点击编辑按钮"""
        buttons = self.page.locator("button:has-text('编辑')")
        if buttons.count() > row_index:
            buttons.nth(row_index).click()
        self.page.wait_for_timeout(1500)

    def click_more_action(self, action_name, row_index=0):
        """点击更多菜单中的操作（删除/停用等）"""
        more_buttons = self.page.locator("button:has-text('更多')")
        if more_buttons.count() > row_index:
            more_buttons.nth(row_index).click()
            self.page.wait_for_timeout(500)
        self.page.get_by_text(action_name, exact=True).click()
        self.page.wait_for_timeout(1000)

    def confirm_action(self):
        """确认操作（弹窗确认）"""
        self.page.get_by_role("button", name="确定").click()
        self.page.wait_for_timeout(1500)

    def is_empty_state(self):
        """判断是否有空状态提示"""
        return self.page.locator("text=请先选择组织").is_visible()

    def get_column_text(self, row_index, column_index):
        """获取指定行指定列的文本"""
        rows = self.page.locator("table tbody tr")
        if rows.count() > row_index:
            cols = rows.nth(row_index).locator("td")
            if cols.count() > column_index:
                return cols.nth(column_index).text_content()
        return ""
