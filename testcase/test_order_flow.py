import time
import pytest
from common.Logger import Logger
from page.frontend_login_page import FrontendLoginPage
from page.frontend_order_page import FrontendOrderPage
from common.database_helper import DatabaseHelper

testlog = Logger.getLogger()


def test_auto_delivery_order_flow(page):
    order_id = None
    user_id = None

    # ==================== 步骤1: 前台登录 ====================
    testlog.info("步骤1: 前台登录")
    frontend_login_page = FrontendLoginPage(page)
    frontend_login_page.open_frontend()
    frontend_login_page.login()
    assert frontend_login_page.is_logged_in(), "前台登录失败"
    testlog.info("前台登录成功")

    # ==================== 步骤2: 浏览商品并下单 ====================
    testlog.info("步骤2: 浏览商品并下单")
    frontend_order_page = FrontendOrderPage(page)
    product_name = frontend_order_page.select_first_product()
    assert product_name is not None, "选择商品失败"
    testlog.info(f"已选择商品: {product_name}")
    frontend_order_page.place_order()
    testlog.info("下单成功")

    # ==================== 步骤3: 获取订单ID和用户ID ====================
    testlog.info("步骤3: 获取订单ID")
    time.sleep(3)
    order_id = frontend_order_page.get_order_id()
    if not order_id:
        order_id = frontend_order_page.get_latest_order_id()
    assert order_id is not None, "获取订单ID失败"
    assert order_id.isdigit(), f"订单ID格式错误: {order_id}"
    testlog.info(f"获取到订单ID: {order_id}")

    # ==================== 步骤4: 等待自动发货 ====================
    testlog.info("步骤4: 等待系统自动发货")
    time.sleep(5)

    # ==================== 步骤5: 数据库验证订单状态和权益 ====================
    testlog.info("步骤5: 数据库验证订单状态和权益")
    with DatabaseHelper() as db_helper:
        order_info = db_helper.query_order_by_id(order_id)
        assert order_info is not None, f"数据库中未找到订单 {order_id}"
        testlog.info("订单信息查询成功")

        user_id = order_info.get('user_id')
        assert user_id is not None, "订单信息中未找到user_id"
        testlog.info(f"订单所属用户ID: {user_id}")

        order_status = order_info.get('status')
        assert order_status is not None, "订单状态为空"
        assert order_status in [2, 'shipped', '已发货'], f"订单状态不正确，期望已发货，实际状态: {order_status}"
        testlog.info(f"订单状态验证通过: {order_status}")

        order_amount = order_info.get('amount') or order_info.get('total_amount')
        assert order_amount is not None, "订单金额为空"
        assert float(order_amount) > 0, "订单金额应大于0"
        testlog.info(f"订单金额验证通过: {order_amount}")

        ship_time = order_info.get('ship_time') or order_info.get('delivery_time')
        assert ship_time is not None, "自动发货后应有发货时间"
        testlog.info(f"发货时间验证通过: {ship_time}")

        order_benefits = db_helper.query_order_benefits(order_id)
        assert order_benefits is not None, "订单权益记录不存在"
        assert len(order_benefits) > 0, "订单应包含至少一个权益"
        testlog.info(f"订单权益数量: {len(order_benefits)}")

        benefits_verified = db_helper.verify_benefits_after_delivery(order_id, user_id)
        assert benefits_verified, "权益验证失败：订单权益未正确添加到用户账户"
        testlog.info("✅ 权益验证成功：订单权益已正确添加到用户账户")

        user_benefits = db_helper.query_user_benefits(user_id)
        assert user_benefits is not None, "用户权益查询失败"

        testlog.info("=" * 50)
        testlog.info("订单信息:")
        testlog.info(f"  - 订单ID: {order_id}")
        testlog.info(f"  - 用户ID: {user_id}")
        testlog.info(f"  - 订单状态: {order_status}")
        testlog.info(f"  - 订单金额: {order_amount}")
        testlog.info(f"  - 发货时间: {ship_time}")

        testlog.info("\n订单权益详情:")
        for i, benefit in enumerate(order_benefits, 1):
            product_name = benefit.get('product_name', '未知产品')
            benefit_type = benefit.get('benefit_type', '未知类型')
            testlog.info(f"  {i}. {product_name} - {benefit_type}")

        testlog.info(f"\n用户当前权益总数: {len(user_benefits)}")
        if user_benefits:
            testlog.info("用户权益列表:")
            for i, benefit in enumerate(user_benefits[:5], 1):
                product_name = benefit.get('product_name', '未知产品')
                benefit_type = benefit.get('benefit_type', '未知类型')
                testlog.info(f"  {i}. {product_name} - {benefit_type}")
            if len(user_benefits) > 5:
                testlog.info(f"  ... 还有 {len(user_benefits) - 5} 个权益")

        testlog.info("=" * 50)
        testlog.info("✅ 所有断言验证通过 - 自动发货流程测试成功")
