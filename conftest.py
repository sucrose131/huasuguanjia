
import pytest
import os
import time

from config.global_cfg import GlobalCfg
from common import RichyExcelRW
RichyExcelRW.rinit(GlobalCfg.CASE_FILE)

@pytest.fixture(scope="session", autouse=True)
def init_logger():

    from common.Logger import Logger
    Logger.init()

@pytest.fixture(scope="function")
def page():

    from playwright.sync_api import sync_playwright

    # 第 1 步：启动 Playwright 客户端
    playwright = sync_playwright().start()

    # 第 2 步：启动 Chromium 浏览器
    # headless=True   → 无头模式（后台运行，不显示界面）
    # headless=False  → 有头模式（能看到浏览器窗口，方便调试）
    # slow_mo        → 操作间延迟（毫秒），模拟真实用户操作速度，0 表示不延迟
    browser = playwright.chromium.launch(
        headless=GlobalCfg.HEADLESS,
        slow_mo=GlobalCfg.SLOW_MO,
    )

    # 第 3 步：创建浏览器上下文
    # viewport 设置视口大小为 1920x1080，模拟标准桌面分辨率
    context = browser.new_context(
        viewport={"width": 1920, "height": 1080},
    )

    # 第 4 步：在上下文中创建一个新的标签页
    pg = context.new_page()

    # ----- yield 之前是"设置"阶段，yield 之后是"清理"阶段 -----
    # yield 将 page 对象传给测试函数，测试函数拿到 pg 后执行测试逻辑
    yield pg

    # ----- 测试函数执行完毕后，开始清理资源 -----
    # 关闭浏览器（释放内存、进程）
    browser.close()

    # 停止 Playwright 服务（彻底释放驱动进程）
    playwright.stop()

@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):

    outcome = yield

    # 获取最终的测试报告对象
    report = outcome.get_result()

    # 只在测试的 call 阶段（实际执行阶段，非 setup/teardown）且状态为 failed 时截图
    if report.when == "call" and report.failed:
        # 尝试从当前测试函数的 fixture 参数中获取 page 对象
        pg = item.funcargs.get("page")
        if pg:
            # 确保 img 截图目录存在
            img_dir = os.path.join(os.path.dirname(__file__), "img")
            os.makedirs(img_dir, exist_ok=True)

            # 生成带时间戳的文件名，避免多次运行互相覆盖
            timestamp = time.strftime("%Y%m%d%H%M%S")
            filename = f"{timestamp}_{item.name}.png"
            filepath = os.path.join(img_dir, filename)

            try:
                # 调用 Playwright 的截图 API 保存当前页面快照
                pg.screenshot(path=filepath)
            except Exception:
                # 截图失败不抛出异常，避免影响测试框架的正常运行
                pass



# 级别	    前置执行	            后置执行	                执行次数
# 全局会话	session fixture	    session fixture	        整个测试会话1次
# 测试模块	module fixture	    module fixture	        每个测试文件1次
# 测试类	    class fixture	    class fixture	        每个测试类1次
# 测试方法	function fixture	function fixture	    每个测试方法1次
# 测试函数	function fixture	function fixture	    每个测试函数1次