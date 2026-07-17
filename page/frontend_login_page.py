from config.global_cfg import GlobalCfg


class FrontendLoginPage:
    def __init__(self, page):
        self.page = page

    def open_frontend(self):
        self.page.goto(GlobalCfg.FRONTEND_URL)
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def login(self, username=None, password=None):
        if username is None:
            username = GlobalCfg.FRONTEND_USERNAME
        if password is None:
            password = GlobalCfg.FRONTEND_PASSWORD

        self.page.get_by_role("button", name="登录").first.click()
        self.page.wait_for_timeout(1000)
        self.page.get_by_placeholder("请输入手机号").fill(username)
        self.page.wait_for_timeout(500)
        self.page.get_by_placeholder("请输入密码").fill(password)
        self.page.wait_for_timeout(500)
        self.page.get_by_role("button", name="登录").first.click()
        self.page.wait_for_timeout(2000)

    def get_user_info(self):
        el = self.page.locator("div.user-info, span.username")
        return el.text_content() if el.count() > 0 else None

    def is_logged_in(self):
        return self.page.locator("div.user-info, span.username").is_visible()
