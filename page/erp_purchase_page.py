"""华溯管家ERP - 采购管理页面对象（采购申请单）"""
from config.global_cfg import GlobalCfg


class ErpPurchasePage:
    """采购申请单页面"""

    def __init__(self, page):
        self.page = page

    def navigate(self):
        """导航到采购申请列表"""
        self.page.goto(f"{GlobalCfg.ERP_URL}dashboard/purchase/apply")
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def get_record_count(self):
        """获取当前列表记录数"""
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
        self.page.wait_for_timeout(1500)

    def fill_form(self, organization=None, department=None, warehouse=None,
                  reason=None, product_name=None, quantity=None, **kwargs):
        """填写采购申请表单"""
        # 选择组织
        if organization:
            self.page.locator("input[placeholder*='组织']").click()
            self.page.wait_for_timeout(500)
            self.page.get_by_text(organization).click()
            self.page.wait_for_timeout(500)

        # 选择部门（联动加载）
        if department:
            self.page.locator("input[placeholder*='部门']").click()
            self.page.wait_for_timeout(500)
            self.page.get_by_text(department).click()
            self.page.wait_for_timeout(500)

        # 选择仓库
        if warehouse:
            self.page.locator("input[placeholder*='仓库']").click()
            self.page.wait_for_timeout(500)
            self.page.get_by_text(warehouse).click()
            self.page.wait_for_timeout(500)

        # 填写原因
        if reason:
            self.page.get_by_label("申请原因").fill(reason)
            self.page.wait_for_timeout(300)

        # 添加商品明细
        if product_name and quantity:
            self.page.get_by_role("button", name="添加明细").click()
            self.page.wait_for_timeout(800)
            # 选择商品
            self.page.locator("input[placeholder*='商品']").click()
            self.page.wait_for_timeout(500)
            self.page.get_by_text(product_name).click()
            self.page.wait_for_timeout(500)
            # 填写数量
            qty_input = self.page.locator("input[placeholder*='数量'], input[type='number']").first
            qty_input.fill(str(quantity))
            self.page.wait_for_timeout(300)

        # 填写备注等额外字段
        if kwargs:
            for field, value in kwargs.items():
                try:
                    self.page.get_by_label(field).fill(str(value))
                except Exception:
                    pass
                self.page.wait_for_timeout(200)

    def save_draft(self):
        """保存草稿"""
        self.page.get_by_role("button", name="保存").click()
        self.page.wait_for_timeout(2000)

    def submit(self):
        """提交审批"""
        # 从列表页点击"更多"→"提交"
        self.page.wait_for_timeout(500)

    def click_more_action(self, action_name, row_index=0):
        """点击更多菜单操作"""
        more_buttons = self.page.locator("button:has-text('更多')")
        if more_buttons.count() > row_index:
            more_buttons.nth(row_index).click()
            self.page.wait_for_timeout(500)
        self.page.get_by_text(action_name, exact=True).click()
        self.page.wait_for_timeout(1000)

    def search(self, keyword):
        """搜索采购申请"""
        search_input = self.page.locator("input[placeholder*='搜索'], input[placeholder*='请输入']").first
        search_input.fill(keyword)
        self.page.wait_for_timeout(300)
        self.page.get_by_role("button", name="查询").click()
        self.page.wait_for_timeout(1500)

    def reset_search(self):
        """重置搜索条件"""
        self.page.get_by_role("button", name="重置").click()
        self.page.wait_for_timeout(1000)

    def filter_by_status(self, status):
        """按审批状态筛选"""
        status_select = self.page.locator("input[placeholder*='状态'], input[placeholder*='审批']").first
        status_select.click()
        self.page.wait_for_timeout(500)
        self.page.get_by_text(status).click()
        self.page.wait_for_timeout(500)
        self.page.get_by_role("button", name="查询").click()
        self.page.wait_for_timeout(1500)

    def get_status_text(self, row_index=0):
        """获取指定行状态文本"""
        rows = self.page.locator("table tbody tr")
        if rows.count() > row_index:
            cols = rows.nth(row_index).locator("td")
            if cols.count() > 5:
                return cols.nth(5).text_content()
        return ""

    def get_sub_menu_count(self):
        """获取采购管理子菜单数量"""
        sub_menus = self.page.locator("aside .el-sub-menu .el-menu-item, aside li.el-menu-item").all_text_contents()
        return len(sub_menus)
