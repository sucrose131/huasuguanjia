"""华溯管家ERP - 销售管理页面对象"""
from config.global_cfg import GlobalCfg


class ErpSalesPage:
    """销售订单页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到销售订单列表"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/sales/order")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def get_record_count(self):
        """获取销售订单数量"""
        total_text = self.page.locator(".el-pagination__total").text_content()
        if total_text:
            import re
            match = re.search(r"共\s*(\d+)\s*条", total_text)
            if match:
                return int(match.group(1))
        return 0

    def click_add(self):
        """点击新增销售订单"""
        self.page.get_by_role("button", name="新增").click()
        self.page.wait_for_timeout(1500)

    def submit_empty(self):
        """空表单点击'保存并提交审核'"""
        self.page.get_by_role("button", name="保存并提交审核").click()
        self.page.wait_for_timeout(1000)

    def is_dialog_open(self):
        """判断新增对话框是否仍打开"""
        return self.page.locator(".el-dialog, .el-drawer, [role='dialog']").is_visible()

    def get_form_fields(self):
        """获取表单字段列表"""
        labels = self.page.locator("label, .el-form-item__label").all_text_contents()
        return [l.strip().rstrip(":：") for l in labels if l.strip()]

    def get_dropdown_options(self, field_placeholder):
        """获取下拉选项列表"""
        dropdown = self.page.locator(f"input[placeholder*='{field_placeholder}']").first
        dropdown.click()
        self.page.wait_for_timeout(800)
        options = self.page.locator(".el-select-dropdown__item, .el-select-dropdown li").all_text_contents()
        return [o.strip() for o in options if o.strip()]

    def fill_order_form(self, customer=None, warehouse=None, product_name=None, quantity=None):
        """填写销售订单表单"""
        if customer:
            self.page.locator("input[placeholder*='客户']").click()
            self.page.wait_for_timeout(500)
            self.page.get_by_text(customer).click()
            self.page.wait_for_timeout(500)

        if warehouse:
            self.page.locator("input[placeholder*='仓库']").click()
            self.page.wait_for_timeout(500)
            self.page.get_by_text(warehouse).click()
            self.page.wait_for_timeout(500)

        if product_name:
            self.page.get_by_role("button", name="添加明细").click()
            self.page.wait_for_timeout(800)
            self.page.locator("input[placeholder*='商品']").click()
            self.page.wait_for_timeout(500)
            self.page.get_by_text(product_name).click()
            self.page.wait_for_timeout(500)

        if quantity:
            qty_input = self.page.locator("input[placeholder*='数量'], input[type='number']").first
            qty_input.fill(str(quantity))
            self.page.wait_for_timeout(300)

    def save_and_submit(self):
        """保存并提交审核"""
        self.page.get_by_role("button", name="保存并提交审核").click()
        self.page.wait_for_timeout(2000)

    def get_sub_menu_items(self):
        """获取销售管理子菜单项"""
        sub_menus = self.page.locator("aside li.el-menu-item").all_text_contents()
        return [m.strip() for m in sub_menus if m.strip()]

    def get_order_status(self, row_index=0):
        """获取订单业务状态"""
        rows = self.page.locator("table tbody tr")
        if rows.count() > row_index:
            return rows.nth(row_index).text_content()
        return ""
