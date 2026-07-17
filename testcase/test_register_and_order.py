import time
import random
import pytest
from common.Logger import Logger
from page.frontend_register_page import FrontendRegisterPage
from page.frontend_login_page import FrontendLoginPage
from page.frontend_order_page import FrontendOrderPage
from common.api_helper import ApiHelper
from common.database_helper import DatabaseHelper

testlog = Logger.getLogger()


@pytest.fixture
def test_phone():
    random_suffix = ''.join([str(random.randint(0, 9)) for _ in range(8)])
    return f"181{random_suffix}"


def test_register_recharge_order_flow(page, test_phone):
    test_password = "abcd1234"
    testlog.info(f"本次测试使用手机号: {test_phone}")

    order_id = None
    user_id = None

    # ==================== 步骤1: 前台填写注册信息并触发获取验证码 ====================
    testlog.info("步骤1: 前台填写注册信息并触发获取验证码")
    register_page = FrontendRegisterPage(page)
    register_page.open_register_page()
    register_page.click_register_button()
    register_page.fill_basic_info(test_phone, password=test_password)
    register_page.click_get_verification_code()
    testlog.info("已点击获取验证码按钮，等待系统发送验证码...")

    # ==================== 步骤2: 从数据库获取验证码 ====================
    testlog.info("步骤2: 从数据库获取验证码")
    time.sleep(2)

    with DatabaseHelper() as db_helper:
        verification_code = db_helper.query_verification_code(test_phone)
        assert verification_code is not None, f"未找到手机号 {test_phone} 的验证码"
        testlog.info(f"获取到验证码: {verification_code}")

    # ==================== 步骤3: 填写验证码并完成注册 ====================
    testlog.info("步骤3: 填写验证码并完成注册")
    register_page.fill_verification_code(verification_code)
    register_page.submit_register()
    assert register_page.is_registered_successfully(), "前台注册失败"
    testlog.info("前台注册成功")

    # ==================== 步骤4: 前台登录 ====================
    testlog.info("步骤4: 前台登录")
    login_page = FrontendLoginPage(page)
    login_page.login(test_phone, test_password)
    assert login_page.is_logged_in(), "前台登录失败"
    testlog.info("前台登录成功")

    # ==================== 步骤5: 获取用户ID并后台充值 ====================
    testlog.info("步骤5: 后台API充值")
    with DatabaseHelper() as db_helper:
        user_info = db_helper.query_user_by_phone(test_phone)
        assert user_info is not None, f"数据库中未找到用户 {test_phone}"
        user_id = user_info.get('id')
        assert user_id is not None, "用户信息中未找到id"
        testlog.info(f"获取到用户ID: {user_id}")

    with ApiHelper() as api_helper:
        token = api_helper.backend_login()
        assert token is not None, "后台API登录失败，未获取到token"
        testlog.info("后台API登录成功，已获取token")
        recharge_success = api_helper.recharge_user(user_id)
        assert recharge_success, f"用户 {user_id} 充值失败"
        testlog.info(f"用户 {user_id} 充值成功")

    # ==================== 步骤6: 前台下单 ====================
    testlog.info("步骤6: 前台浏览商品并下单")
    order_page = FrontendOrderPage(page)
    product_name = order_page.select_first_product()
    assert product_name is not None, "选择商品失败"
    testlog.info(f"已选择商品: {product_name}")
    order_page.place_order()
    testlog.info("下单成功")

    # ==================== 步骤7: 获取订单ID并等待自动发货 ====================
    testlog.info("步骤7: 获取订单ID并等待自动发货")
    time.sleep(3)
    order_id = order_page.get_order_id()
    if not order_id:
        order_id = order_page.get_latest_order_id()
    assert order_id is not None, "获取订单ID失败"
    assert order_id.isdigit(), f"订单ID格式错误: {order_id}"
    testlog.info(f"获取到订单ID: {order_id}")
    time.sleep(5)
    testlog.info("等待自动发货完成")

    # ==================== 步骤8: 数据库验证权益和身份 ====================
    testlog.info("步骤8: 数据库验证权益和身份")
    with DatabaseHelper() as db_helper:
        order_info = db_helper.query_order_by_id(order_id)
        assert order_info is not None, f"数据库中未找到订单 {order_id}"
        testlog.info("✅ 断言1通过: 订单存在")

        order_user_id = order_info.get('user_id')
        assert order_user_id == user_id, f"订单用户ID不匹配，期望: {user_id}, 实际: {order_user_id}"
        testlog.info("✅ 断言2通过: 订单属于当前用户")

        order_status = order_info.get('order_status')
        assert order_status is not None, "订单状态为空"
        assert order_status in [4], f"订单状态不正确，期望已发货，实际状态: {order_status}"
        testlog.info(f"✅ 断言3通过: 订单状态为已发货 ({order_status})")

        order_amount = order_info.get('actual_amount') or order_info.get('total_amount')
        assert order_amount is not None, "订单金额为空"
        assert float(order_amount) > 0, "订单金额应大于0"
        testlog.info(f"✅ 断言4通过: 订单金额正确 ({order_amount})")

        ship_time = order_info.get('shipping_time')
        assert ship_time is not None, "自动发货后应有发货时间"
        testlog.info(f"✅ 断言5通过: 发货时间存在 ({ship_time})")

        order_benefits = db_helper.query_order_benefits(order_id)
        assert order_benefits is not None, "订单权益记录不存在"
        assert len(order_benefits) > 0, "订单应包含至少一个权益"
        testlog.info(f"✅ 断言6通过: 订单权益记录存在 (共{len(order_benefits)}个)")

        benefits_verified = db_helper.verify_benefits_after_delivery(order_id, user_id)
        assert benefits_verified, "权益验证失败：订单权益未正确添加到用户账户"
        testlog.info("✅ 断言7通过: 用户已获得订单权益")

        expected_identity = "个人消费者"
        identity_verified = db_helper.verify_user_identity(user_id, expected_identity)
        assert identity_verified, f"用户身份验证失败，期望: {expected_identity}"
        testlog.info(f"✅ 断言8通过: 用户身份验证通过 ({expected_identity})")

        testlog.info("=" * 60)
        testlog.info("测试结果汇总:")
        testlog.info(f"  - 手机号: {test_phone}")
        testlog.info(f"  - 用户ID: {user_id}")
        testlog.info(f"  - 订单ID: {order_id}")
        testlog.info(f"  - 订单状态: {order_status}")
        testlog.info(f"  - 订单金额: {order_amount}")
        testlog.info(f"  - 发货时间: {ship_time}")
        testlog.info(f"  - 权益数量: {len(order_benefits)}")
        testlog.info(f"  - 用户身份: {expected_identity}")
        testlog.info("=" * 60)
        testlog.info("✅ 所有断言验证通过 - 注册下单流程测试成功")
