import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const outputDir = '/Users/vannyino/Desktop/hspsi 2/outputs/项目计划甘特图';
const outputPath = `${outputDir}/华溯管家-项目实施计划甘特图.xlsx`;

const d = (day) => new Date(2026, 7, day);
const tasks = [
  [
    '0.1',
    '项目管理',
    '项目启动与当前代码基线确认',
    '冻结已实现范围、目标库与交付边界',
    '项目组',
    '任羲宸',
    '任羲宸',
    d(3),
    d(3),
    '',
    1,
    '低',
    '是',
  ],
  [
    '1.1',
    '数据初始化',
    '基础数据模板与口径冻结',
    '商品、供应商、客户、期初库存模板',
    '各业务部门',
    '陈素梅',
    '胡丹',
    d(3),
    d(4),
    '0.1',
    0.8,
    '中',
    '是',
  ],
  [
    '1.2',
    '数据初始化',
    '业务基础数据清洗',
    '完成重复、缺失、编码冲突处理',
    '采购/行政/健服/财务/客服',
    '陈素梅',
    '胡丹',
    d(4),
    d(6),
    '1.1',
    0.45,
    '高',
    '是',
  ],
  [
    '1.3',
    '数据初始化',
    '数据导入与总量核对',
    '数据进入指定库并形成核对记录',
    '技术部+业务部门',
    '陈素梅',
    '胡丹',
    d(6),
    d(7),
    '1.2',
    0.1,
    '高',
    '是',
  ],

  [
    '2.1',
    '权限与审批',
    '组织、角色、审批责任矩阵冻结',
    '组织×角色×菜单×审批节点矩阵',
    '技术部+各部门负责人',
    '徐贵艳',
    '胡丹',
    d(3),
    d(5),
    '0.1',
    0.35,
    '高',
    '是',
  ],
  [
    '2.2',
    '权限与审批',
    '全链级组织数据隔离模型',
    '组织数据范围及跨组织授权规则',
    '技术部',
    '徐贵艳',
    '胡丹',
    d(4),
    d(7),
    '2.1',
    0.1,
    '高',
    '是',
  ],
  [
    '2.3',
    '权限与审批',
    '业务 API 数据范围强制过滤',
    '采购、生产、库存、销售、领用接口隔离',
    '技术部',
    '徐贵艳',
    '胡丹',
    d(6),
    d(11),
    '2.2',
    0,
    '高',
    '是',
  ],
  [
    '2.4',
    '权限与审批',
    '审批节点与状态流转完善',
    '申请审批、驳回、重提与留痕',
    '技术部',
    '徐贵艳',
    '胡丹',
    d(7),
    d(12),
    '2.1',
    0,
    '高',
    '是',
  ],
  [
    '2.5',
    '权限与审批',
    '前端数据范围与权限管理界面',
    '可见组织、操作权限与审批权限一致',
    '技术部',
    '徐贵艳',
    '胡丹',
    d(10),
    d(13),
    '2.3,2.4',
    0,
    '中',
    '是',
  ],
  [
    '2.6',
    '权限与审批',
    '权限及越权回归测试',
    '形成角色/组织越权测试报告',
    '技术部',
    '任羲宸',
    '卢志悟',
    d(13),
    d(14),
    '2.5',
    0,
    '高',
    '是',
  ],

  [
    '3.1',
    '外部系统集成',
    '接口清单与数据契约确认',
    'OA、华溯之家、十方清源字段及事件清单',
    '技术部+外部系统方',
    '徐贵艳',
    '胡丹',
    d(4),
    d(6),
    '0.1',
    0.2,
    '高',
    '是',
  ],
  [
    '3.2',
    '外部系统集成',
    '统一鉴权、日志与幂等框架',
    '公共接口框架及联调日志',
    '技术部',
    '徐贵艳',
    '胡丹',
    d(5),
    d(8),
    '3.1',
    0,
    '高',
    '是',
  ],
  [
    '3.3',
    '外部系统集成',
    'OA 系统接口开发与联调',
    '组织、人员、审批结果可同步',
    '技术部+OA系统方',
    '徐贵艳',
    '胡丹',
    d(7),
    d(11),
    '3.1,3.2',
    0,
    '高',
    '是',
  ],
  [
    '3.4',
    '外部系统集成',
    '华溯之家接口开发与联调',
    '约定业务数据可稳定交换',
    '技术部+华溯之家',
    '徐贵艳',
    '胡丹',
    d(8),
    d(12),
    '3.1,3.2',
    0,
    '高',
    '是',
  ],
  [
    '3.5',
    '外部系统集成',
    '十方清源接口开发与联调',
    '约定业务数据可稳定交换',
    '技术部+十方清源',
    '徐贵艳',
    '胡丹',
    d(10),
    d(14),
    '3.1,3.2',
    0,
    '高',
    '是',
  ],
  [
    '3.6',
    '外部系统集成',
    '失败重试、对账与异常补偿',
    '接口异常可追踪、可重试、可对账',
    '技术部',
    '徐贵艳',
    '胡丹',
    d(12),
    d(15),
    '3.3,3.4,3.5',
    0,
    '高',
    '是',
  ],
  [
    '3.7',
    '外部系统集成',
    '三套外部系统联合验收',
    '联调结果确认单',
    '技术部+外部系统方',
    '徐贵艳',
    '胡丹',
    d(15),
    d(16),
    '3.6',
    0,
    '高',
    '是',
  ],

  [
    '4.1',
    '系统调优',
    '四大核心业务链回归与收口',
    '销售—生产—采购—库存闭环通过',
    '技术部+业务部门',
    '任羲宸',
    '任羲宸、樊宗豪',
    d(3),
    d(7),
    '0.1',
    0.6,
    '中',
    '否',
  ],
  [
    '4.2',
    '系统调优',
    '领用管理内部链路收口',
    '申请、出库、退还链路通过',
    '技术部+行政/健服',
    '任羲宸',
    '任羲宸、樊宗豪',
    d(5),
    d(7),
    '0.1',
    0.7,
    '低',
    '否',
  ],
  [
    '4.3',
    '系统调优',
    '工作台与报表真实数据适配',
    '总览、消息、统计口径可用',
    '技术部',
    '任羲宸',
    '任羲宸、樊宗豪',
    d(6),
    d(8),
    '4.1',
    0.5,
    '中',
    '否',
  ],
  [
    '4.4',
    '系统调优',
    '菜单、表单、弹框与需求文档统一',
    '界面及需求说明保持一致',
    '技术部',
    '任羲宸',
    '任羲宸、樊宗豪',
    d(3),
    d(8),
    '0.1',
    0.7,
    '低',
    '否',
  ],
  [
    '4.5',
    '系统调优',
    'P0/P1 问题集中关闭',
    '阻断演示和上线的问题清零',
    '技术部',
    '任羲宸',
    '任羲宸、樊宗豪',
    d(8),
    d(13),
    '4.1,4.2,4.3,4.4',
    0,
    '高',
    '是',
  ],

  [
    '5.1',
    '系统测试',
    '构建、类型检查与 API 冒烟',
    '构建通过、关键接口可访问',
    '技术部',
    '任羲宸',
    '卢志悟',
    d(10),
    d(12),
    '4.1',
    0,
    '中',
    '否',
  ],
  [
    '5.2',
    '系统测试',
    '三大业务场景回归测试',
    '销售闭环、盘点、领用用例通过',
    '技术部+业务部门',
    '任羲宸',
    '卢志悟',
    d(12),
    d(15),
    '4.5,5.1',
    0,
    '高',
    '是',
  ],
  [
    '5.3',
    '系统测试',
    '数据、权限与审批专项测试',
    '数据准确且无越权',
    '技术部',
    '任羲宸',
    '卢志悟',
    d(14),
    d(16),
    '2.6,5.1',
    0,
    '高',
    '是',
  ],
  [
    '5.4',
    '系统测试',
    '外部接口回归测试',
    '三套外部系统交换稳定',
    '技术部+外部系统方',
    '任羲宸',
    '卢志悟',
    d(16),
    d(17),
    '3.7',
    0,
    '高',
    '是',
  ],
  [
    '5.5',
    '系统测试',
    '用户验收测试（UAT）',
    'UAT问题清单与业务签字',
    '各业务部门',
    '任羲宸',
    '卢志悟',
    d(18),
    d(19),
    '5.2,5.3,5.4',
    0,
    '高',
    '是',
  ],

  [
    '6.1',
    '系统部署',
    'Docker 与生产环境参数确认',
    '生产部署包与启动说明',
    '技术部',
    '徐贵艳',
    '周公策',
    d(14),
    d(16),
    '5.1',
    0.9,
    '低',
    '否',
  ],
  [
    '6.2',
    '系统部署',
    '备份、恢复与回滚演练',
    '可执行回滚方案',
    '技术部',
    '徐贵艳',
    '周公策',
    d(16),
    d(17),
    '6.1',
    0,
    '中',
    '是',
  ],
  [
    '6.3',
    '系统部署',
    '生产环境发布',
    '系统正式发布',
    '技术部',
    '徐贵艳',
    '周公策',
    d(18),
    d(18),
    '5.3,5.4,6.2',
    0,
    '高',
    '是',
  ],

  [
    '7.1',
    '系统培训',
    '培训材料与操作用例定版',
    '操作手册、场景用例与常见问题',
    '技术部+各业务部门',
    '徐贵艳',
    '任羲宸',
    d(16),
    d(18),
    '5.2',
    0,
    '低',
    '否',
  ],
  [
    '7.2',
    '系统培训',
    '线上及线下用户培训',
    '关键用户完成培训',
    '技术部+各业务部门',
    '徐贵艳',
    '任羲宸',
    d(19),
    d(19),
    '7.1',
    0,
    '中',
    '是',
  ],

  [
    '8.1',
    '系统试运行',
    '生产试运行与技术支持',
    '真实业务连续运行',
    '技术部+各业务部门',
    '徐贵艳',
    '任羲宸',
    d(20),
    d(23),
    '6.3,7.2',
    0,
    '高',
    '是',
  ],
  [
    '8.2',
    '系统试运行',
    '试运行问题关闭',
    '试运行P0/P1问题清零',
    '技术部',
    '徐贵艳',
    '任羲宸',
    d(20),
    d(24),
    '8.1',
    0,
    '高',
    '是',
  ],
  [
    '8.3',
    '项目验收',
    '项目交付验收',
    '验收纪要及遗留事项清单',
    '项目组',
    '徐贵艳',
    '任羲宸',
    d(25),
    d(25),
    '8.2',
    0,
    '高',
    '是',
  ],
];

const milestones = [
  ['M1', '基础数据完成导入', d(7), '1.3', '陈素梅 / 胡丹', '高'],
  ['M2', '组织隔离及审批权限完成', d(14), '2.6', '徐贵艳 / 胡丹', '高'],
  ['M3', '外部系统联合验收', d(16), '3.7', '徐贵艳 / 胡丹', '高'],
  ['M4', '核心业务P0/P1关闭', d(13), '4.5', '任羲宸 / 樊宗豪', '高'],
  ['M5', '用户验收测试完成', d(19), '5.5', '任羲宸 / 卢志悟', '高'],
  ['M6', '生产环境正式发布', d(18), '6.3', '徐贵艳 / 周公策', '高'],
  ['M7', '用户培训完成', d(19), '7.2', '徐贵艳 / 任羲宸', '中'],
  ['M8', '项目验收', d(25), '8.3', '徐贵艳 / 任羲宸', '高'],
];

const risks = [
  [
    'R1',
    '组织数据隔离',
    '审批责任矩阵或数据边界迟迟未冻结',
    '越权或跨组织数据泄露',
    '先冻结组织×角色×数据范围矩阵，再开发API过滤；前端隐藏不代替后端校验',
    '徐贵艳 / 胡丹',
    d(5),
    '开放',
  ],
  [
    'R2',
    '外部系统接口',
    '接口文档、测试账号或对方环境未按期提供',
    'OA/华溯之家/十方清源联调延期',
    '建立接口清单、模拟服务和每日联调窗口，异常统一登记',
    '徐贵艳 / 胡丹',
    d(6),
    '开放',
  ],
  [
    'R3',
    '数据初始化',
    '业务源数据编码重复、字段缺失或库存口径不一致',
    '导入失败或期初数据不可信',
    '分批清洗、导入前校验、导入后总量与抽样双核对',
    '陈素梅 / 胡丹',
    d(7),
    '处理中',
  ],
  [
    'R4',
    '核心业务回归',
    '跨模块状态或单据关联存在遗漏',
    '三大场景无法闭环',
    '按销售闭环、盘点、领用三条验收用例逐节点验证',
    '任羲宸 / 卢志悟',
    d(15),
    '开放',
  ],
  [
    'R5',
    '生产部署',
    '生产环境参数、备份或回滚未验证',
    '发布后无法快速恢复',
    '发布前完成镜像、数据库备份与回滚演练',
    '徐贵艳 / 周公策',
    d(17),
    '开放',
  ],
  [
    'R6',
    '人员投入',
    '关键业务负责人或外部系统方无法按计划参与',
    '需求确认与UAT排队',
    '提前锁定每日确认窗口，逾期事项升级到项目负责人',
    '徐贵艳',
    d(5),
    '开放',
  ],
];

const wb = Workbook.create();
const gantt = wb.worksheets.add('项目甘特图');
const mr = wb.worksheets.add('里程碑与风险');
const notes = wb.worksheets.add('参数与说明');

const navy = '#0B1F3A';
const blue = '#2563EB';
const midBlue = '#60A5FA';
const lightBlue = '#DBEAFE';
const paleBlue = '#EFF6FF';
const slate = '#475569';
const border = '#CBD5E1';
const soft = '#F8FAFC';
const amber = '#F59E0B';
const red = '#DC2626';
const green = '#16A34A';

// Parameters and instructions
notes.showGridLines = false;
notes.getRange('A1:H1').merge();
notes.getRange('A1').values = [['华溯管家 · 项目实施计划参数与使用说明']];
notes.getRange('A1:H1').format = {
  fill: navy,
  font: { bold: true, color: '#FFFFFF', size: 18 },
  verticalAlignment: 'center',
};
notes.getRange('A1:H1').format.rowHeight = 34;
notes.getRange('A3:B8').values = [
  ['参数', '可编辑值'],
  ['计划基准日期', d(3)],
  ['项目负责人', '任羲宸'],
  ['指定业务数据库', 'hspsi-dev-ai-02'],
  ['时间轴显示天数', 31],
  ['计划版本', '2026-08-03 基线'],
];
notes.getRange('A3:B3').format = { fill: blue, font: { bold: true, color: '#FFFFFF' } };
notes.getRange('B4').format.numberFormat = 'yyyy-mm-dd';
notes.getRange('A10:H10').merge();
notes.getRange('A10').values = [['编辑方法']];
notes.getRange('A10:H10').format = { fill: lightBlue, font: { bold: true, color: navy } };
notes.getRange('A11:H16').values = [
  [
    '1',
    '在“项目甘特图”中修改开始日期、完成日期和完成进度，右侧甘特条会自动变化。',
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  [
    '2',
    '黄色输入列为可编辑字段；状态、工期和甘特条均由公式计算。',
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  [
    '3',
    '完成进度填写0%—100%；关键路径用于识别会直接影响上线日期的任务。',
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  [
    '4',
    '如需整体平移计划，只需修改各任务起止日期；时间轴基准日期可在本页B4修改。',
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  [
    '5',
    '当前重新评估后的计划完成日期为2026-08-25，主要卡点是组织数据隔离与外部系统联调。',
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  [
    '6',
    '本计划以当前代码实现为基线：核心业务链以回归收口为主，不把既有功能按从零开发估时。',
    null,
    null,
    null,
    null,
    null,
    null,
  ],
];
for (let r = 11; r <= 16; r++) notes.getRange(`B${r}:H${r}`).merge();
notes.getRange('A11:H16').format = {
  wrapText: true,
  verticalAlignment: 'center',
  borders: { preset: 'insideHorizontal', style: 'thin', color: border },
};
notes.getRange('A18:H18').merge();
notes.getRange('A18').values = [['颜色图例']];
notes.getRange('A18:H18').format = { fill: lightBlue, font: { bold: true, color: navy } };
notes.getRange('A19:B23').values = [
  ['深蓝', '已完成区间'],
  ['浅蓝', '计划执行区间'],
  ['橙色', '中风险'],
  ['红色', '高风险/关键阻断'],
  ['浅灰', '周末'],
];
notes.getRange('A19:A23').format.font = { bold: true };
notes.getRange('A19').format.fill = blue;
notes.getRange('A20').format.fill = lightBlue;
notes.getRange('A21').format.fill = '#FEF3C7';
notes.getRange('A22').format.fill = '#FEE2E2';
notes.getRange('A23').format.fill = '#E2E8F0';
notes.getRange('A:A').format.columnWidth = 18;
notes.getRange('B:B').format.columnWidth = 28;
notes.getRange('C:H').format.columnWidth = 14;
notes.getRange('B4:B8').format.fill = '#FFF7D6';
notes.freezePanes.freezeRows(3);

// Main Gantt sheet
gantt.showGridLines = false;
gantt.getRange('A1:AS1').merge();
gantt.getRange('A1').values = [['华溯管家 · 项目实施可编辑甘特图']];
gantt.getRange('A1:AS1').format = {
  fill: navy,
  font: { bold: true, color: '#FFFFFF', size: 20 },
  verticalAlignment: 'center',
};
gantt.getRange('A1:AS1').format.rowHeight = 38;
gantt.getRange('A2:AS2').merge();
gantt.getRange('A2').values = [
  [
    '负责人：任羲宸 ｜ 基线：2026-08-03 ｜ 当前评估完成：2026-08-25 ｜ 关键卡点：组织数据隔离、审批权限、三套外部系统联调',
  ],
];
gantt.getRange('A2:AS2').format = {
  fill: '#E8EEF8',
  font: { color: navy, size: 11 },
  verticalAlignment: 'center',
};
gantt.getRange('A3:B3').merge();
gantt.getRange('A3').values = [['计划任务']];
gantt.getRange('C3:D3').merge();
gantt.getRange('C3').formulas = [['=COUNTA(C8:C60)']];
gantt.getRange('E3:F3').merge();
gantt.getRange('E3').values = [['关键路径任务']];
gantt.getRange('G3:H3').merge();
gantt.getRange('G3').formulas = [['=COUNTIF(N8:N60,"是")']];
gantt.getRange('I3:J3').merge();
gantt.getRange('I3').values = [['整体进度']];
gantt.getRange('K3:L3').merge();
gantt.getRange('K3').formulas = [['=SUMPRODUCT(J8:J60,L8:L60)/SUM(J8:J60)']];
gantt.getRange('M3:N3').merge();
gantt.getRange('M3').values = [['计划完成']];
gantt.getRange('O3:Q3').merge();
gantt.getRange('O3').formulas = [['=MAX(I8:I60)']];
gantt.getRange('A3:Q3').format = {
  borders: { preset: 'outside', style: 'thin', color: border },
  verticalAlignment: 'center',
};
for (const r of ['A3:B3', 'E3:F3', 'I3:J3', 'M3:N3'])
  gantt.getRange(r).format = {
    fill: slate,
    font: { bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
  };
for (const r of ['C3:D3', 'G3:H3', 'K3:L3', 'O3:Q3'])
  gantt.getRange(r).format = {
    fill: '#FFFFFF',
    font: { bold: true, color: navy, size: 13 },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    borders: { preset: 'outside', style: 'thin', color: border },
  };
gantt.getRange('K3').format.numberFormat = '0%';
gantt.getRange('O3').format.numberFormat = 'yyyy-mm-dd';
gantt.getRange('A4:AS4').merge();
gantt.getRange('A4').values = [
  [
    '黄色列可直接编辑；工期、状态和右侧甘特条自动计算。深蓝为已完成区间，浅蓝为剩余计划区间，灰色为周末。',
  ],
];
gantt.getRange('A4:AS4').format = {
  fill: '#FFF7D6',
  font: { color: '#7C5B00', italic: true },
  verticalAlignment: 'center',
};

const headers = [
  'WBS',
  '阶段',
  '任务',
  '交付物/完成标准',
  '执行部门',
  '业务统筹',
  '技术执行人',
  '开始日期',
  '完成日期',
  '工期',
  '前置任务',
  '完成进度',
  '风险',
  '关键路径',
];
gantt.getRange('A6:N6').values = [headers];
gantt.getRange('A6:N7').format = {
  fill: blue,
  font: { bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  wrapText: true,
  borders: { preset: 'all', style: 'thin', color: '#93C5FD' },
};
for (let c = 0; c < 14; c++) gantt.getRangeByIndexes(5, c, 2, 1).merge();

const timelineStartCol = 14; // O
const timelineDays = 31;
for (let c = 0; c < timelineDays; c++) {
  const col = gantt.getRangeByIndexes(5, timelineStartCol + c, 1, 1);
  col.formulas = [[`='参数与说明'!$B$4+${c}`]];
  col.format.numberFormat = 'm/d';
  gantt.getRangeByIndexes(6, timelineStartCol + c, 1, 1).formulas = [
    [
      `=CHOOSE(WEEKDAY(${col.address.split('!').pop()},2),\"一\",\"二\",\"三\",\"四\",\"五\",\"六\",\"日\")`,
    ],
  ];
}
gantt.getRange('O6:AS7').format = {
  fill: navy,
  font: { bold: true, color: '#FFFFFF', size: 9 },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  borders: { preset: 'all', style: 'thin', color: slate },
};

const startRow = 8;
const values = tasks.map((t) => [
  t[0],
  t[1],
  t[2],
  t[3],
  t[4],
  t[5],
  t[6],
  t[7],
  t[8],
  null,
  t[9],
  t[10],
  t[11],
  t[12],
]);
gantt.getRangeByIndexes(startRow - 1, 0, values.length, 14).values = values;
for (let i = 0; i < tasks.length; i++) {
  const r = startRow + i;
  gantt.getRange(`J${r}`).formulas = [[`=I${r}-H${r}+1`]];
  for (let c = 0; c < timelineDays; c++) {
    const colIndex = timelineStartCol + c;
    const headerAddress = gantt.getRangeByIndexes(5, colIndex, 1, 1).address.split('!').pop();
    gantt.getRangeByIndexes(r - 1, colIndex, 1, 1).formulas = [
      [
        `=IF(AND(${headerAddress}>=$H${r},${headerAddress}<=$I${r}),IF(${headerAddress}<=$H${r}+ROUND($J${r}*$L${r},0)-1,2,1),\"\")`,
      ],
    ];
  }
}
const endRow = startRow + tasks.length - 1;
gantt.getRange(`A8:N${endRow}`).format = {
  font: { color: '#1E293B', size: 10 },
  verticalAlignment: 'center',
  wrapText: true,
  borders: { insideHorizontal: { style: 'thin', color: '#E2E8F0' } },
};
gantt.getRange(`A8:A${endRow}`).format.horizontalAlignment = 'center';
gantt.getRange(`H8:J${endRow}`).format.horizontalAlignment = 'center';
gantt.getRange(`H8:I${endRow}`).format.numberFormat = 'yyyy-mm-dd';
gantt.getRange(`J8:J${endRow}`).format.numberFormat = '0';
gantt.getRange(`L8:L${endRow}`).format.numberFormat = '0%';
gantt.getRange(`H8:I${endRow}`).format.fill = '#FFF7D6';
gantt.getRange(`L8:L${endRow}`).format.fill = '#FFF7D6';
gantt.getRange(`M8:N${endRow}`).format.horizontalAlignment = 'center';
gantt.getRange(`O8:AS${endRow}`).format = {
  numberFormat: ';;;',
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  borders: { preset: 'all', style: 'thin', color: '#E2E8F0' },
};
gantt.getRange(`O8:AS${endRow}`).conditionalFormats.add('cellIs', {
  operator: 'equal',
  formula: 2,
  format: { fill: blue, font: { color: blue } },
});
gantt.getRange(`O8:AS${endRow}`).conditionalFormats.add('cellIs', {
  operator: 'equal',
  formula: 1,
  format: { fill: lightBlue, font: { color: lightBlue } },
});
gantt.getRange(`M8:M${endRow}`).conditionalFormats.add('containsText', {
  text: '高',
  format: { fill: '#FEE2E2', font: { color: red, bold: true } },
});
gantt.getRange(`M8:M${endRow}`).conditionalFormats.add('containsText', {
  text: '中',
  format: { fill: '#FEF3C7', font: { color: '#B45309', bold: true } },
});
gantt.getRange(`L8:L${endRow}`).conditionalFormats.add('dataBar', { color: blue, gradient: true });
gantt.getRange(`L8:L${endRow}`).dataValidation = {
  rule: { type: 'decimal', operator: 'between', formula1: 0, formula2: 1 },
};
gantt.getRange(`M8:M${endRow}`).dataValidation = {
  rule: { type: 'list', values: ['低', '中', '高'] },
};
gantt.getRange(`N8:N${endRow}`).dataValidation = { rule: { type: 'list', values: ['是', '否'] } };

// Weekend shading on empty timeline cells; task bars remain visibly colored.
for (let c = 0; c < timelineDays; c++) {
  const head = gantt
    .getRangeByIndexes(5, timelineStartCol + c, 1, 1)
    .address.split('!')
    .pop();
  const rg = gantt.getRangeByIndexes(startRow - 1, timelineStartCol + c, tasks.length, 1);
  rg.conditionalFormats.addCustom(`=AND(WEEKDAY(${head},2)>5,${head}<$H${startRow})`, {
    fill: '#F1F5F9',
  });
}

const widths = [7, 13, 28, 34, 25, 12, 18, 12, 12, 7, 12, 10, 8, 9];
widths.forEach((w, i) => (gantt.getRangeByIndexes(0, i, 1, 1).format.columnWidth = w));
gantt.getRange('O:AS').format.columnWidth = 4.2;
gantt.getRange(`8:${endRow}`).format.rowHeight = 34;
gantt.getRange('6:7').format.rowHeight = 24;
gantt.freezePanes.freezeRows(7);
gantt.freezePanes.freezeColumns(14);

// Milestones and risks
mr.showGridLines = false;
mr.getRange('A1:H1').merge();
mr.getRange('A1').values = [['里程碑与风险清单']];
mr.getRange('A1:H1').format = {
  fill: navy,
  font: { bold: true, color: '#FFFFFF', size: 18 },
  verticalAlignment: 'center',
};
mr.getRange('A3:F3').values = [['编号', '里程碑', '计划日期', '对应WBS', '责任人', '级别']];
mr.getRange('A3:F3').format = {
  fill: blue,
  font: { bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
};
mr.getRangeByIndexes(3, 0, milestones.length, 6).values = milestones;
mr.getRange(`A4:F${3 + milestones.length}`).format = {
  borders: { preset: 'insideHorizontal', style: 'thin', color: border },
  verticalAlignment: 'center',
  wrapText: true,
};
mr.getRange(`C4:C${3 + milestones.length}`).format.numberFormat = 'yyyy-mm-dd';
mr.getRange(`F4:F${3 + milestones.length}`).conditionalFormats.add('containsText', {
  text: '高',
  format: { fill: '#FEE2E2', font: { color: red, bold: true } },
});
const riskHeaderRow = 14;
mr.getRange(`A${riskHeaderRow}:H${riskHeaderRow}`).values = [
  ['编号', '风险主题', '触发条件', '影响', '应对措施', '责任人', '控制日期', '状态'],
];
mr.getRange(`A${riskHeaderRow}:H${riskHeaderRow}`).format = {
  fill: slate,
  font: { bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
};
mr.getRangeByIndexes(riskHeaderRow, 0, risks.length, 8).values = risks;
mr.getRange(`A${riskHeaderRow + 1}:H${riskHeaderRow + risks.length}`).format = {
  borders: { preset: 'insideHorizontal', style: 'thin', color: border },
  verticalAlignment: 'center',
  wrapText: true,
};
mr.getRange(`G${riskHeaderRow + 1}:G${riskHeaderRow + risks.length}`).format.numberFormat =
  'yyyy-mm-dd';
mr.getRange(`H${riskHeaderRow + 1}:H${riskHeaderRow + risks.length}`).dataValidation = {
  rule: { type: 'list', values: ['开放', '处理中', '已关闭'] },
};
mr.getRange(`H${riskHeaderRow + 1}:H${riskHeaderRow + risks.length}`).format.fill = '#FFF7D6';
[8, 20, 32, 28, 50, 22, 13, 12].forEach(
  (w, i) => (mr.getRangeByIndexes(0, i, 1, 1).format.columnWidth = w),
);
mr.getRange(`4:${3 + milestones.length}`).format.rowHeight = 27;
mr.getRange(`${riskHeaderRow + 1}:${riskHeaderRow + risks.length}`).format.rowHeight = 48;
mr.freezePanes.freezeRows(3);

await fs.mkdir(outputDir, { recursive: true });

// Compact verification before export.
const inspectMain = await wb.inspect({
  kind: 'table',
  range: `项目甘特图!A1:N${Math.min(endRow, 18)}`,
  include: 'values,formulas',
  tableMaxRows: 18,
  tableMaxCols: 14,
  maxChars: 8000,
});
console.log(inspectMain.ndjson);
const errors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'final formula error scan',
});
console.log(errors.ndjson);

const preview1 = await wb.render({
  sheetName: '项目甘特图',
  range: `A1:AS${Math.min(endRow, 22)}`,
  scale: 1,
  format: 'png',
});
await fs.writeFile(`${outputDir}/项目甘特图预览.png`, new Uint8Array(await preview1.arrayBuffer()));
const preview2 = await wb.render({
  sheetName: '里程碑与风险',
  range: 'A1:H20',
  scale: 1.2,
  format: 'png',
});
await fs.writeFile(
  `${outputDir}/里程碑与风险预览.png`,
  new Uint8Array(await preview2.arrayBuffer()),
);
const preview3 = await wb.render({
  sheetName: '参数与说明',
  range: 'A1:H23',
  scale: 1.2,
  format: 'png',
});
await fs.writeFile(`${outputDir}/参数与说明预览.png`, new Uint8Array(await preview3.arrayBuffer()));

const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(JSON.stringify({ outputPath, taskCount: tasks.length, endRow, previews: 3 }));
