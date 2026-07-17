from config.global_cfg import GlobalCfg


class FrontendRegisterPage:
    def __init__(self, page):
        self.page = page

    def open_register_page(self):
        self.page.goto(GlobalCfg.FRONTEND_URL)
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(2000)

    def click_register_button(self):
        self.page.locator("//span[contains(normalize-space(),'立即注册')]").click()
        self.page.wait_for_timeout(1000)

    def fill_basic_info(self, phone, name="测试用户", password=None):
        if password is None:
            password = GlobalCfg.REGISTER_PASSWORD

        self.page.locator("//uni-view[position()=2]/uni-view[position()=2]/uni-input[position()=1]/div[position()=1]/input[position()=1]").fill(phone)
        self.page.wait_for_timeout(500)
        self.page.locator("/html/body/div[1]/uni-app/uni-page/uni-page-wrapper/uni-page-body/uni-view/uni-view[1]/uni-view[4]/uni-view[2]/uni-input/div/input").fill(name)
        self.page.wait_for_timeout(500)
        self.page.locator("/html/body/div[1]/uni-app/uni-page/uni-page-wrapper/uni-page-body/uni-view/uni-view[1]/uni-view[5]/uni-view[2]/uni-input/div/input").fill(password)
        self.page.wait_for_timeout(500)
        confirm = self.page.locator("/html/body/div[1]/uni-app/uni-page/uni-page-wrapper/uni-page-body/uni-view/uni-view[1]/uni-view[6]/uni-view[2]/uni-input/div/input")
        if confirm.is_visible():
            confirm.fill(password)
            self.page.wait_for_timeout(500)

    def click_get_verification_code(self):
        self.page.locator("/html/body/div[1]/uni-app/uni-page/uni-page-wrapper/uni-page-body/uni-view/uni-view[1]/uni-view[3]/uni-view[2]/uni-view").click()
        self.page.wait_for_timeout(3000)

    def fill_verification_code(self, verification_code):
        self.page.locator("/html/body/div[1]/uni-app/uni-page/uni-page-wrapper/uni-page-body/uni-view/uni-view[1]/uni-view[3]/uni-view[2]/uni-input/div/input").fill(verification_code)
        self.page.wait_for_timeout(500)

    def submit_register(self):
        self.page.get_by_role("button", name="注册").first.click()
        self.page.wait_for_timeout(3000)

    def register(self, phone, verification_code, password=None):
        if password is None:
            password = GlobalCfg.REGISTER_PASSWORD

        self.click_register_button()
        self.fill_basic_info(phone, password=password)
        self.click_get_verification_code()
        self.fill_verification_code(verification_code)
        self.submit_register()

    def is_registered_successfully(self):
        return self.page.locator("/html/body/div[3]/uni-toast/div").is_visible()
