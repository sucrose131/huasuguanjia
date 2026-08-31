-- 账套按应用保存薪福通事件订阅验签公钥。该公钥由薪福通在配置回调 URL 后按应用生成，不能使用全局环境变量。

ALTER TABLE `hspsi_sys_account_set`
  ADD COLUMN `event_public_key` varchar(255) NOT NULL DEFAULT '' COMMENT '薪福通事件订阅验签公钥（SM2未压缩hex，130位）' AFTER `app_secret`;
