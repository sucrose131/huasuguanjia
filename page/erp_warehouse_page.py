"""华溯管家ERP - 仓库与商品管理页面对象"""
from config.global_cfg import GlobalCfg


class ErpWarehousePage:
    """仓库管理页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到仓库列表"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/data/warehouse")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def get_warehouse_count(self):
        """获取仓库数量"""
        total_text = self.page.locator(".el-pagination__total").text_content()
        if total_text:
            import re
            match = re.search(r"共\s*(\d+)\s*条", total_text)
            if match:
                return int(match.group(1))
        return 0

    def get_warehouse_names(self):
        """获取所有仓库名称"""
        rows = self.page.locator("table tbody tr")
        names = []
        for i in range(rows.count()):
            cols = rows.nth(i).locator("td")
            if cols.count() > 0:
                names.append(cols.nth(0).text_content())
        return names


class ErpProductPage:
    """商品管理页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到商品资料列表"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/data/product")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def get_product_count(self):
        """获取商品数量"""
        total_text = self.page.locator(".el-pagination__total").text_content()
        if total_text:
            import re
            match = re.search(r"共\s*(\d+)\s*条", total_text)
            if match:
                return int(match.group(1))
        return 0
