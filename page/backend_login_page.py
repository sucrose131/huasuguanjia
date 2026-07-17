from config.global_cfg import GlobalCfg


class BackendLoginPage:
    def __init__(self, page):
        self.page = page

    def open_backend(self):
        self.page.goto(GlobalCfg.BACKEND_URL)
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def login(self, username=None, password=None):
        if username is None:
            username = GlobalCfg.BACKEND_USERNAME
        if password is None:
            password = GlobalCfg.BACKEND_PASSWORD

        self.page.get_by_placeholder("请输入账号").fill(username)
        self.page.wait_for_timeout(500)
        self.page.get_by_placeholder("请输入密码").fill(password)
        self.page.wait_for_timeout(500)
        self.page.get_by_role("button", name="登录").first.click()
        self.page.wait_for_timeout(3000)

    def is_logged_in(self):
        return self.page.locator("div.dashboard, div:has-text('控制台')").is_visible()
