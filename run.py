import pytest
import os
from config.global_cfg import GlobalCfg
from common import RichyExcelRW

RichyExcelRW.rinit(GlobalCfg.CASE_FILE)

# 默认运行注册下单流程，可通过命令行参数覆盖
# 例如: python run.py -k login  运行登录测试
#       python run.py           运行所有测试
if __name__ == "__main__":
    pytest.main([
        "--html", os.path.join(GlobalCfg.REPORT_PATH, GlobalCfg.REPORT_NAME),
        "--self-contained-html",
        *__import__('sys').argv[1:]
    ])
