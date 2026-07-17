"""华溯管家ERP - 库存管理页面对象"""
from config.global_cfg import GlobalCfg


class ErpInventoryPage:
    """库存查询页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到库存查询"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/inventory/query")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def is_org_required_message_visible(self):
        """检查是否显示'请先选择组织'提示"""
        return self.page.locator("text=请先选择组织").is_visible()

    def select_organization(self, org_name):
        """选择组织"""
        org_select = self.page.locator("input[placeholder*='组织']").first
        org_select.click()
        self.page.wait_for_timeout(500)
        self.page.get_by_text(org_name).click()
        self.page.wait_for_timeout(2000)

    def filter_by_warehouse(self, warehouse_name):
        """按仓库筛选"""
        self.page.get_by_text(warehouse_name).click()
        self.page.wait_for_timeout(1000)

    def get_stock_item_count(self):
        """获取库存品项数"""
        total_text = self.page.locator(".el-pagination__total").text_content()
        if total_text:
            import re
            match = re.search(r"共\s*(\d+)\s*条", total_text)
            if match:
                return int(match.group(1))
        return 0

    def get_total_value(self):
        """获取库存总值"""
        value_text = self.page.locator("text*=库存总值, text*=¥").text_content()
        if not value_text:
            value_text = self.page.text_content()
        import re
        match = re.search(r"¥\s*[\d,]+\.?\d*", value_text)
        if match:
            return match.group(0)
        return "未获取"

    def get_warehouse_tags(self):
        """获取仓库标签列表"""
        tags = self.page.locator(".el-tag, .el-button--small, button:has-text('仓')").all_text_contents()
        return [t.strip() for t in tags if t.strip()]

    def get_stock_flow_count(self):
        """获取库存流水记录数"""
        flow_rows = self.page.locator("table tbody tr:has-text('采购入库'), table tbody tr:has-text('出库')")
        return flow_rows.count()

    def toggle_has_stock_only(self):
        """切换'仅显示有库存'复选框"""
        checkbox = self.page.locator("label:has-text('仅显示有库存')")
        checkbox.click()
        self.page.wait_for_timeout(1000)

    def search_product(self, keyword):
        """搜索商品"""
        search_input = self.page.locator("input[placeholder*='商品'], input[placeholder*='搜索']").first
        search_input.fill(keyword)
        self.page.wait_for_timeout(300)
        self.page.get_by_role("button", name="查询").click()
        self.page.wait_for_timeout(1500)

    def change_page_size(self, size):
        """切换每页条数"""
        size_select = self.page.locator("input[placeholder*='条']").last
        size_select.click()
        self.page.wait_for_timeout(300)
        self.page.get_by_text(str(size)).click()
        self.page.wait_for_timeout(1500)
