import logging
from config.global_cfg import GlobalCfg
class Logger():
    @classmethod
    def init(cls):
        logging.basicConfig(level=logging.DEBUG,
                            format="%(asctime)s %(levelname)s %(filename)s: %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S",
                            handlers=[logging.FileHandler(GlobalCfg.LOG_PATH,"a","utf-8"),logging.StreamHandler()]
                            )
        logging.getLogger("urllib3").setLevel(logging.WARNING)#关闭urllib3日志
        cls.testlog=logging.getLogger("131")#自定义日志名称
        cls.testlog.setLevel(logging.DEBUG)
    @classmethod
    def getLogger(cls):
        return cls.testlog

