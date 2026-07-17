"""华溯管家ERP - 登录页面对象"""
from config.global_cfg import GlobalCfg


class ErpLoginPage:
    """登录页面"""

    def __init__(self, page):
        self.page = page

    def open(self):
        """打开ERP系统登录页"""
        self.page.goto(GlobalCfg.ERP_URL)
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def login(self, username=None, password=None):
        """执行登录操作"""
        if username is None:
            username = GlobalCfg.ERP_USERNAME
        if password is None:
            password = GlobalCfg.ERP_PASSWORD

        self.page.get_by_placeholder("请输入账号").fill(username)
        self.page.wait_for_timeout(300)
        self.page.get_by_placeholder("请输入密码").fill(password)
        self.page.wait_for_timeout(300)
        self.page.get_by_role("button", name="登录").click()
        self.page.wait_for_timeout(3000)

    def is_logged_in(self):
        """判断是否已登录"""
        return self.page.locator("div.dashboard, div:has-text('工作台'), div:has-text('数据总览')").is_visible()

    def get_menu_modules(self):
        """获取左侧一级菜单模块列表"""
        menu_items = self.page.locator("aside .el-menu-item, aside .el-sub-menu__title").all_text_contents()
        return [item.strip() for item in menu_items if item.strip()]

    def click_menu(self, menu_name):
        """点击左侧菜单"""
        self.page.get_by_text(menu_name, exact=False).first.click()
        self.page.wait_for_timeout(1000)

    def click_sub_menu(self, parent_menu, sub_menu):
        """点击子菜单：先展开父菜单再点击子菜单"""
        parent = self.page.get_by_text(parent_menu, exact=False).first
        if parent:
            parent.click()
            self.page.wait_for_timeout(800)
        self.page.get_by_text(sub_menu, exact=False).first.click()
        self.page.wait_for_timeout(1500)
