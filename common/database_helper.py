import pymysql
from config.global_cfg import GlobalCfg
from common.Logger import Logger


class DatabaseHelper:


    """数据库操作帮助类"""
    
    def __init__(self):
        self.logger = Logger.getLogger()
        self.connection = None
        
    def connect(self):
        """建立数据库连接"""
        try:
            self.connection = pymysql.connect(
                host=GlobalCfg.DB_HOST,
                port=GlobalCfg.DB_PORT,
                user=GlobalCfg.DB_USERNAME,
                password=GlobalCfg.DB_PASSWORD,
                database=GlobalCfg.DB_DATABASE,
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )
            self.logger.info("数据库连接成功")
            return True
        except Exception as e:
            self.logger.error(f"数据库连接失败: {str(e)}")
            return False
    
    def disconnect(self):
        """关闭数据库连接"""
        if self.connection:
            self.connection.close()
            self.logger.info("数据库连接已关闭")
    
    def query_order_by_id(self, order_id):
        """根据订单ID查询订单信息"""
        try:
            if not self.connection:
                self.connect()
            
            cursor = self.connection.cursor()
            sql = "SELECT * FROM hszj_order WHERE id = %s"
            cursor.execute(sql, (order_id,))
            result = cursor.fetchone()
            cursor.close()
            
            if result:
                self.logger.info(f"查询到订单信息: {result}")
            else:
                self.logger.warning(f"未找到订单ID: {order_id}")
            
            return result
        except Exception as e:
            self.logger.error(f"查询订单失败: {str(e)}")
            return None
    
    def query_verification_code(self, mobile):

        """查询手机号对应的最新验证码"""
        try:
            if not self.connection:
                self.connect()
            
            cursor = self.connection.cursor()
            # 验证码表名为 hszj_user_mobile_code，需要根据实际表结构调整
            sql = """
                SELECT code, created_at 
                FROM hszj_user_mobile_code 
                WHERE mobile = %s 
                ORDER BY created_at DESC 
                LIMIT 1
            """
            cursor.execute(sql, (mobile,))
            result = cursor.fetchone()
            cursor.close()
            
            if result:
                self.logger.info(f"查询到手机号 {mobile} 的验证码: {result['code']}")
                return result['code']
            else:
                self.logger.warning(f"未找到手机号 {mobile} 的验证码")
                return None
        except Exception as e:
            self.logger.error(f"查询验证码失败: {str(e)}")
            return None
    
    def query_user_by_phone(self, phone):
        """根据手机号查询用户信息"""
        try:
            if not self.connection:
                self.connect()
            
            cursor = self.connection.cursor()
            # 用户表名为 hszj_user，需要根据实际表结构调整
            sql = "SELECT * FROM hszj_user WHERE mobile = %s"
            cursor.execute(sql, (phone,))
            result = cursor.fetchone()
            cursor.close()
            
            if result:
                self.logger.info(f"查询到用户信息: {result}")
            else:
                self.logger.warning(f"未找到手机号 {phone} 的用户")
            
            return result
        except Exception as e:
            self.logger.error(f"查询用户失败: {str(e)}")
            return None
    
    def query_user_identity(self, user_id):
        """查询用户身份信息"""
        try:
            if not self.connection:
                self.connect()
            
            cursor = self.connection.cursor()
            # 假设身份表名为 user_identities，需要根据实际表结构调整
            sql = """
                SELECT 
                    hszj_user.id,
                    hszj_user.mobile,
                    hszj_user.nickname,
                    hszj_user.gender,
                    hszj_user.birth,
                    hszj_user.level_id,
                    hszj_user_level.name,
                    hszj_user_level.level,
                    hszj_user.balance,
                    hszj_user.status
                FROM hszj_user
                LEFT JOIN hszj_user_level ON hszj_user.level_id = hszj_user_level.id
                WHERE hszj_user.uid = %s 
                    AND hszj_user.deleted_at IS NULL
            """
            cursor.execute(sql, (user_id,))
            result = cursor.fetchone()
            cursor.close()
            
            if result:
                self.logger.info(f"查询到用户 {user_id} 的身份信息: {result}")
            else:
                self.logger.warning(f"未找到用户 {user_id} 的身份信息")
            
            return result
        except Exception as e:
            self.logger.error(f"查询用户身份失败: {str(e)}")
            return None
    
    def verify_user_identity(self, user_id, expected_identity):
        """验证用户身份是否与预期一致"""
        try:
            identity_info = self.query_user_identity(user_id)
            
            if not identity_info:
                self.logger.error(f"用户 {user_id} 没有身份信息")
                return False
            
            # 假设身份字段为 identity_type，需要根据实际数据库调整
            actual_identity = identity_info.get('name') or identity_info.get('level')
            
            if actual_identity == expected_identity:
                self.logger.info(f"用户身份验证通过: {actual_identity}")
                return True
            else:
                self.logger.error(f"用户身份不匹配，期望: {expected_identity}, 实际: {actual_identity}")
                return False
        except Exception as e:
            self.logger.error(f"验证用户身份失败: {str(e)}")
            return False
    
    def query_order_benefits(self, order_id):
        """查询订单对应的权益信息"""
        try:
            if not self.connection:
                self.connect()
            
            cursor = self.connection.cursor()
            # 假设权益表名为 order_benefits，需要根据实际表结构调整
            sql = """
                SELECT oi.*, p.name as product_name, p.single_type as benefit_type 
                FROM hszj_order_item oi
                LEFT JOIN hszj_product p ON oi.product_id = p.id
                WHERE oi.order_sn = %s
            """
            cursor.execute(sql, (order_id,))
            results = cursor.fetchall()
            cursor.close()
            
            self.logger.info(f"查询到订单 {order_id} 的权益信息: {results}")
            return results
        except Exception as e:
            self.logger.error(f"查询订单权益失败: {str(e)}")
            return None
    
    def query_user_benefits(self, user_id):
        """查询用户当前拥有的权益"""
        try:
            if not self.connection:
                self.connect()
            
            cursor = self.connection.cursor()
            # 假设用户权益表名为 user_benefits，需要根据实际表结构调整
            sql = """
                SELECT ur.*, p.name as product_name, p.single_type as benefit_type
                FROM hszj_user_rights ur
                LEFT JOIN hszj_product p ON ur.product_id = p.id
                WHERE ur.user_id = %s
            """
            cursor.execute(sql, (user_id,))
            results = cursor.fetchall()
            cursor.close()
            
            self.logger.info(f"查询到用户 {user_id} 的权益信息: {results}")
            return results
        except Exception as e:
            self.logger.error(f"查询用户权益失败: {str(e)}")
            return None
    
    def verify_benefits_after_delivery(self, order_id, user_id):
        """验证发货后用户权益是否正确添加"""
        try:
            # 查询订单中的权益
            order_benefits = self.query_order_benefits(order_id)
            # 查询用户当前的权益
            user_benefits = self.query_user_benefits(user_id)
            
            if not order_benefits:
                self.logger.error(f"订单 {order_id} 没有权益信息")
                return False
            
            if not user_benefits:
                self.logger.error(f"用户 {user_id} 没有权益信息")
                return False
            
            # 验证订单中的权益是否都在用户权益中
            order_benefit_ids = {benefit['product_id'] for benefit in order_benefits}
            user_benefit_ids = {benefit['product_id'] for benefit in user_benefits}
            
            missing_benefits = order_benefit_ids - user_benefit_ids
            
            if missing_benefits:
                self.logger.error(f"用户缺少以下权益: {missing_benefits}")
                return False
            
            self.logger.info(f"订单 {order_id} 的权益已成功添加到用户 {user_id}")
            return True
            
        except Exception as e:
            self.logger.error(f"验证权益失败: {str(e)}")
            return False
    
    def __enter__(self):
        """支持上下文管理器"""
        self.connect()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """退出上下文时关闭连接"""
        self.disconnect()


if __name__ == "__main__":
    # 测试数据库连接
    with DatabaseHelper() as db:
        print("数据库连接测试成功")
