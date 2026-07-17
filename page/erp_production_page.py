"""华溯管家ERP - 生产管理页面对象"""
from config.global_cfg import GlobalCfg


class ErpProductionPage:
    """生产计划单页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到生产计划单列表"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/production/plan")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def get_record_count(self):
        """获取生产计划单数量"""
        total_text = self.page.locator(".el-pagination__total").text_content()
        if total_text:
            import re
            match = re.search(r"共\s*(\d+)\s*条", total_text)
            if match:
                return int(match.group(1))
        return 0

    def get_action_buttons(self):
        """获取列表操作按钮"""
        buttons = self.page.locator("table tbody tr button").all_text_contents()
        return [b.strip() for b in buttons if b.strip()]

    def has_button(self, button_name):
        """检查是否存在指定按钮"""
        return self.page.get_by_role("button", name=button_name).count() > 0


class ErpBOMPage:
    """BOM编排页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到BOM编排"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/production/bom")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def get_bom_count(self):
        """获取BOM数量"""
        total_text = self.page.locator(".el-pagination__total").text_content()
        if total_text:
            import re
            match = re.search(r"共\s*(\d+)\s*条", total_text)
            if match:
                return int(match.group(1))
        return 0
