import re


class FrontendOrderPage:
    def __init__(self, page):
        self.page = page

    def browse_products(self):
        return self.page.locator("div.product, div.goods").all()

    def select_first_product(self):
        self.page.locator("div.product, div.goods").first.click()
        self.page.wait_for_timeout(2000)
        el = self.page.locator("div.product-name, h1")
        return el.text_content() if el.count() > 0 else None

    def place_order(self):
        self.page.get_by_role("button", name="立即购买").first.click()
        self.page.wait_for_timeout(2000)
        self.page.get_by_role("button", name="提交订单").first.click()
        self.page.wait_for_timeout(3000)

    def get_order_id(self):
        el = self.page.locator("div.order-no, span:has-text('订单号')")
        if el.count() > 0:
            order_text = el.text_content() or ""
            match = re.search(r'\d+', order_text)
            return match.group() if match else None
        return None

    def go_to_my_orders(self):
        self.page.locator("div:has-text('我的订单'), a:has-text('订单')").first.click()
        self.page.wait_for_timeout(2000)

    def get_latest_order_id(self):
        self.go_to_my_orders()
        el = self.page.locator("div.order-item").first
        if el.count() > 0:
            order_text = el.text_content() or ""
            match = re.search(r'\d+', order_text)
            return match.group() if match else None
        return None

    def confirm_receive(self):
        self.go_to_my_orders()
        self.page.wait_for_timeout(1000)
        self.page.get_by_role("button", name="确认收货").click()
        self.page.wait_for_timeout(2000)

    def check_benefits(self):
        self.page.locator("div.my-benefits, div:has-text('我的权益')").first.click()
        self.page.wait_for_timeout(2000)
        benefits = self.page.locator("div.benefit, div.rights").all()
        return [b.text_content() or "" for b in benefits]
