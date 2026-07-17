import os,pathlib
import time


class GlobalCfg():
    DOWNLOAD_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "../download"))
    FILE_FOLDER= os.path.join(pathlib.Path(os.path.dirname(__file__)).parent, "file")
    LOG_PATH= os.path.join(os.path.join(pathlib.Path(os.path.dirname(__file__)).parent,"log"),time.strftime("%Y%m%d%H")+".log")#
    IMG_PATH = os.path.join(os.path.join(pathlib.Path(os.path.dirname(__file__)).parent, "img"),time.strftime("%Y%m%d%H%M%S") + ".png")
    BASE_URL="http://192.168.2.217:8094/#/login"
    CASE_FILE= os.path.join(os.path.join(pathlib.Path(os.path.dirname(__file__)).parent,"datas"),"cloudtranslation.xlsx")#
    REPORT_PATH=os.path.join(pathlib.Path(os.path.dirname(__file__)).parent,"report")
    REPORT_NAME=time.strftime("%Y%m%d%H")+"cloudtranslation"+".html"#报告生成
    
    # 华数生物项目配置
    FRONTEND_URL = "https://hshome.h5.test.huasubiotech.com/"
    BACKEND_URL = "https://hshome.backend.test.huasubiotech.com/"
    
    # 前台账号
    FRONTEND_USERNAME = "18100000005"
    FRONTEND_PASSWORD = "abcd1234"
    
    # 后台账号
    BACKEND_USERNAME = "1131"
    BACKEND_PASSWORD = "abcd1234!"
    
    # 数据库配置
    DB_CONNECTION = "mysql"
    DB_HOST = "47.107.44.209"
    DB_PORT = 13306
    DB_DATABASE = "hshome-test"
    DB_USERNAME = "luzhiwu"
    DB_PASSWORD = "yHRkNTQe4B"
    
    # API充值接口路径
    BACKEND_LOGIN_API = "/backend/admin/public/account/login"
    BACKEND_SHIP_API = "/backend/admin/order/ship"
    BACKEND_RECHARGE_API = "/backend/admin/user/member/recharge"  # 后台充值接口
    
    # 注册配置
    REGISTER_PASSWORD = "abcd1234"  # 注册默认密码
    RECHARGE_AMOUNT = 100  # 充值金额（元）

    # 华溯管家ERP测试配置
    ERP_URL = "http://hspsi.dev.huasubiotech.com/"
    ERP_USERNAME = "admin"
    ERP_PASSWORD = "admin123"

    HEADLESS = False  # 显示浏览器
    SLOW_MO = 500  # 放慢速度，看得清楚




