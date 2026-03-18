/**
 * 错误处理配置文件
 * 定义各种错误类型的处理策略和用户友好的错误消息
 */

// 错误代码映射到用户友好的消息
export const ERROR_MESSAGES = {
  // 网络相关错误
  NETWORK_ERROR: '网络连接失败，请检查网络设置后重试',
  TIMEOUT_ERROR: '操作超时，请稍后重试或调整超时设置',
  CONNECTION_REFUSED: '无法连接到服务器，请检查网络连接',

  // API相关错误
  API_ERROR: 'API调用失败，请稍后重试',
  API_KEY_INVALID: 'API密钥无效，请检查配置',
  API_RATE_LIMIT: 'API调用频率过高，请稍后重试',
  API_QUOTA_EXCEEDED: 'API调用配额已用完，请明天再试',
  API_SERVICE_UNAVAILABLE: 'API服务暂时不可用，请稍后重试',

  // 验证相关错误
  VALIDATION_ERROR: '输入数据格式不正确',
  INVALID_SHOP_CODE: '店铺代码格式不正确，请检查输入',
  INVALID_URL: 'URL格式不正确，请输入有效的乐天店铺链接',
  MISSING_REQUIRED_FIELD: '缺少必需的字段',

  // 存储相关错误
  STORAGE_ERROR: '数据存储失败，请检查浏览器存储权限',
  STORAGE_QUOTA_EXCEEDED: '存储空间不足，请清理部分数据',
  STORAGE_ACCESS_DENIED: '无法访问存储，请检查权限设置',

  // 任务相关错误
  TASK_ERROR: '任务执行失败',
  TASK_ALREADY_RUNNING: '相同任务正在执行中，请等待完成',
  TASK_CANCELLED: '任务已被取消',
  TASK_TIMEOUT: '任务执行超时',

  // 配置相关错误
  CONFIGURATION_ERROR: '配置错误，请检查设置',
  MISSING_API_KEY: '未配置API密钥，请在选项页面设置',
  INVALID_CONFIGURATION: '配置格式不正确',

  // 权限相关错误
  PERMISSION_ERROR: '权限不足，无法执行操作',
  PERMISSION_DENIED: '操作被拒绝，请检查权限设置',

  // 数据完整性错误
  DATA_INTEGRITY_ERROR: '数据完整性检查失败',
  CORRUPTED_DATA: '数据已损坏，请重新获取',
  INVALID_DATA_FORMAT: '数据格式不正确',

  // 通用错误
  UNKNOWN_ERROR: '发生未知错误，请重试',
  OPERATION_FAILED: '操作失败',
  INTERNAL_ERROR: '内部错误，请联系技术支持',
};

// 错误严重程度级别
export const ERROR_SEVERITY = {
  LOW: 'low', // 轻微错误，不影响主要功能
  MEDIUM: 'medium', // 中等错误，影响部分功能
  HIGH: 'high', // 严重错误，影响主要功能
  CRITICAL: 'critical', // 致命错误，系统无法正常工作
};

// 错误代码到严重程度的映射
export const ERROR_SEVERITY_MAP = {
  // 低严重程度
  VALIDATION_ERROR: ERROR_SEVERITY.LOW,
  INVALID_URL: ERROR_SEVERITY.LOW,
  MISSING_REQUIRED_FIELD: ERROR_SEVERITY.LOW,

  // 中等严重程度
  NETWORK_ERROR: ERROR_SEVERITY.MEDIUM,
  TIMEOUT_ERROR: ERROR_SEVERITY.MEDIUM,
  API_RATE_LIMIT: ERROR_SEVERITY.MEDIUM,
  STORAGE_ERROR: ERROR_SEVERITY.MEDIUM,

  // 高严重程度
  API_KEY_INVALID: ERROR_SEVERITY.HIGH,
  API_QUOTA_EXCEEDED: ERROR_SEVERITY.HIGH,
  STORAGE_QUOTA_EXCEEDED: ERROR_SEVERITY.HIGH,
  PERMISSION_DENIED: ERROR_SEVERITY.HIGH,

  // 致命严重程度
  API_SERVICE_UNAVAILABLE: ERROR_SEVERITY.CRITICAL,
  CORRUPTED_DATA: ERROR_SEVERITY.CRITICAL,
  INTERNAL_ERROR: ERROR_SEVERITY.CRITICAL,
};

// 重试策略配置
export const RETRY_STRATEGIES = {
  // 网络错误重试策略
  NETWORK_ERROR: {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2,
    maxDelay: 10000,
  },

  // API错误重试策略
  API_ERROR: {
    maxRetries: 2,
    retryDelay: 2000,
    backoffMultiplier: 1.5,
    maxDelay: 8000,
  },

  // 超时错误重试策略
  TIMEOUT_ERROR: {
    maxRetries: 2,
    retryDelay: 3000,
    backoffMultiplier: 2,
    maxDelay: 12000,
  },

  // 默认重试策略
  DEFAULT: {
    maxRetries: 1,
    retryDelay: 1000,
    backoffMultiplier: 1,
    maxDelay: 5000,
  },
};

// 错误处理动作配置
export const ERROR_ACTIONS = {
  // 显示通知
  SHOW_NOTIFICATION: 'show_notification',

  // 记录日志
  LOG_ERROR: 'log_error',

  // 重试操作
  RETRY_OPERATION: 'retry_operation',

  // 回退到默认值
  FALLBACK_TO_DEFAULT: 'fallback_to_default',

  // 清理资源
  CLEANUP_RESOURCES: 'cleanup_resources',

  // 重定向用户
  REDIRECT_USER: 'redirect_user',

  // 请求用户输入
  REQUEST_USER_INPUT: 'request_user_input',
};

// 错误代码到处理动作的映射
export const ERROR_ACTION_MAP = {
  MISSING_API_KEY: [
    ERROR_ACTIONS.SHOW_NOTIFICATION,
    ERROR_ACTIONS.REDIRECT_USER,
  ],

  NETWORK_ERROR: [
    ERROR_ACTIONS.LOG_ERROR,
    ERROR_ACTIONS.RETRY_OPERATION,
    ERROR_ACTIONS.SHOW_NOTIFICATION,
  ],

  VALIDATION_ERROR: [ERROR_ACTIONS.LOG_ERROR, ERROR_ACTIONS.REQUEST_USER_INPUT],

  STORAGE_QUOTA_EXCEEDED: [
    ERROR_ACTIONS.SHOW_NOTIFICATION,
    ERROR_ACTIONS.CLEANUP_RESOURCES,
  ],

  API_RATE_LIMIT: [ERROR_ACTIONS.LOG_ERROR, ERROR_ACTIONS.RETRY_OPERATION],
};

// 用户指导消息
export const USER_GUIDANCE = {
  MISSING_API_KEY: {
    title: '需要确认服务器连接',
    message: '请打开设置页，确认扩展正在连接固定服务器 https://api.845817074.xyz。',
    actionText: '查看连接',
    actionUrl: 'options.html',
  },

  NETWORK_ERROR: {
    title: '网络连接问题',
    message: '请检查您的网络连接，确保能够访问乐天网站。',
    actionText: '重试',
    actionUrl: null,
  },

  STORAGE_QUOTA_EXCEEDED: {
    title: '存储空间不足',
    message: '请清理一些旧的数据以释放存储空间。',
    actionText: '清理数据',
    actionUrl: null,
  },

  API_QUOTA_EXCEEDED: {
    title: 'API调用次数已达上限',
    message: '今日API调用次数已用完，请明天再试或升级您的API套餐。',
    actionText: '了解更多',
    actionUrl: 'https://webservice.rakuten.co.jp/',
  },
};

// 获取用户友好的错误消息
export function getUserFriendlyMessage(errorCode, defaultMessage = null) {
  return (
    ERROR_MESSAGES[errorCode] ||
    defaultMessage ||
    ERROR_MESSAGES['UNKNOWN_ERROR']
  );
}

// 获取错误严重程度
export function getErrorSeverity(errorCode) {
  return ERROR_SEVERITY_MAP[errorCode] || ERROR_SEVERITY.MEDIUM;
}

// 获取重试策略
export function getRetryStrategy(errorCode) {
  return RETRY_STRATEGIES[errorCode] || RETRY_STRATEGIES['DEFAULT'];
}

// 获取错误处理动作
export function getErrorActions(errorCode) {
  return ERROR_ACTION_MAP[errorCode] || [ERROR_ACTIONS.LOG_ERROR];
}

// 获取用户指导信息
export function getUserGuidance(errorCode) {
  return USER_GUIDANCE[errorCode] || null;
}

// 判断错误是否应该重试
export function shouldRetryError(errorCode) {
  const actions = getErrorActions(errorCode);
  return actions.includes(ERROR_ACTIONS.RETRY_OPERATION);
}

// 判断错误是否需要用户干预
export function requiresUserIntervention(errorCode) {
  const actions = getErrorActions(errorCode);
  return (
    actions.includes(ERROR_ACTIONS.REQUEST_USER_INPUT) ||
    actions.includes(ERROR_ACTIONS.REDIRECT_USER)
  );
}
