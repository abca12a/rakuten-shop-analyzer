/**
 * 统一错误处理机制使用示例
 * 展示如何在不同场景下使用错误处理系统
 */

/* eslint-disable no-unused-vars */
import {
  ValidationError,
  NetworkError,
  ApiError,
  StorageError,
  TimeoutError,
  ConfigurationError,
} from './errorHandler.js';

import {
  withApiErrorHandling,
  withStorageErrorHandling,
  withNetworkErrorHandling,
  errorHandler,
} from './errorMiddleware.js';
/* eslint-enable no-unused-vars */

// 示例1: 基本的异步函数错误处理
export async function basicErrorHandlingExample() {
  console.log('=== 基本错误处理示例 ===');

  // 使用wrapAsync包装可能出错的函数
  const result = await errorHandler.wrapAsync(
    async () => {
      // 模拟可能失败的操作
      if (Math.random() > 0.5) {
        throw new Error('随机错误');
      }
      return { data: '成功的数据' };
    },
    '基本操作示例',
    {
      throwOnError: false,
      defaultValue: { data: '默认数据' },
    }
  );

  console.log('操作结果:', result);
}

// 示例2: 带重试的网络请求
export async function networkRequestWithRetryExample() {
  console.log('=== 网络请求重试示例 ===');

  const fetchData = async url => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new NetworkError(
        `请求失败: ${response.status}`,
        url,
        response.status
      );
    }
    return response.json();
  };

  // 使用网络错误处理中间件
  const wrappedFetch = withNetworkErrorHandling(
    fetchData,
    'https://api.example.com/data'
  );

  try {
    const data = await wrappedFetch('https://api.example.com/data');
    console.log('网络请求成功:', data);
  } catch (error) {
    console.log('网络请求最终失败:', error.message);
  }
}

// 示例3: API调用错误处理
export async function apiCallExample() {
  console.log('=== API调用错误处理示例 ===');

  const callRakutenApi = async (endpoint, params) => {
    // 模拟API调用
    if (params.invalid) {
      throw new ApiError('API参数错误', endpoint, {
        error: 'invalid_parameter',
      });
    }
    return { success: true, data: 'API响应数据' };
  };

  const wrappedApiCall = withApiErrorHandling(
    callRakutenApi,
    'IchibaItem/Search'
  );

  try {
    const result = await wrappedApiCall('IchibaItem/Search', {
      shopCode: 'test',
    });
    console.log('API调用成功:', result);
  } catch (error) {
    console.log('API调用失败:', error.message);
  }
}

// 示例4: 存储操作错误处理
export async function storageOperationExample() {
  console.log('=== 存储操作错误处理示例 ===');

  const saveData = async key => {
    // 模拟存储操作
    if (key === 'invalid') {
      throw new StorageError('存储键名无效', 'save', key);
    }
    return { success: true };
  };

  const wrappedSave = withStorageErrorHandling(saveData, '保存数据');

  try {
    await wrappedSave('validKey', { test: 'data' });
    console.log('存储操作成功');
  } catch (error) {
    console.log('存储操作失败:', error.message);
  }
}

// 示例5: 参数验证
export function parameterValidationExample() {
  console.log('=== 参数验证示例 ===');

  try {
    // 验证参数
    errorHandler.validateParams(
      {
        shopCode: 'test-shop',
        page: 1,
        email: 'invalid-email',
      },
      {
        shopCode: {
          required: true,
          type: 'string',
          minLength: 3,
        },
        page: {
          required: true,
          type: 'number',
        },
        email: {
          required: false,
          type: 'string',
          pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        },
      }
    );

    console.log('参数验证通过');
  } catch (error) {
    console.log('参数验证失败:', error.message);
  }
}

// 示例6: 类方法装饰器
export class ExampleService {
  constructor() {
    this.data = new Map();
  }

  // 使用手动包装为方法添加错误处理（替代装饰器语法）
  async getUserData(userId) {
    return await errorHandler.wrapAsync(
      async () => {
        if (!userId) {
          throw new ValidationError('用户ID不能为空', 'userId', userId);
        }

        // 模拟数据获取
        if (userId === 'error') {
          throw new Error('用户不存在');
        }

        return { id: userId, name: `用户${userId}` };
      },
      '获取用户数据',
      {
        errorCode: 'USER_DATA_ERROR',
        retry: { maxRetries: 2, retryDelay: 1000 },
      }
    );
  }

  async saveUserData(userId, userData) {
    return await errorHandler.wrapAsync(
      async () => {
        if (!userId || !userData) {
          throw new ValidationError('用户ID和数据都是必需的');
        }

        this.data.set(userId, userData);
        return { success: true };
      },
      '保存用户数据',
      {
        errorCode: 'USER_SAVE_ERROR',
      }
    );
  }
}

// 示例7: 错误统计和分析
export async function errorStatsExample() {
  console.log('=== 错误统计示例 ===');

  // 模拟一些错误
  for (let i = 0; i < 5; i++) {
    try {
      await errorHandler.wrapAsync(
        async () => {
          throw new NetworkError('网络连接失败');
        },
        '网络操作',
        { throwOnError: true }
      );
    } catch (error) {
      // 错误已被记录
    }
  }

  // 获取错误统计
  const stats = errorHandler.getErrorStats();
  console.log('错误统计:', stats);

  // 导出错误历史
  const history = errorHandler.exportErrorHistory();
  console.log('错误历史导出完成，长度:', history.length);
}

// 示例8: 超时处理
export async function timeoutHandlingExample() {
  console.log('=== 超时处理示例 ===');

  const slowOperation = async () => {
    return new Promise(resolve => {
      setTimeout(() => resolve('操作完成'), 5000);
    });
  };

  try {
    // 设置3秒超时
    const result = await Promise.race([
      slowOperation(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError('操作超时', 3000, '慢速操作'));
        }, 3000);
      }),
    ]);

    console.log('操作结果:', result);
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.log('操作超时:', error.message);
    }
  }
}

// 示例9: 配置错误处理
export async function configurationErrorExample() {
  console.log('=== 配置错误处理示例 ===');

  try {
    // 检查配置
    const config = await getConfiguration();
    if (!config.apiKey) {
      throw new ConfigurationError('API密钥未配置', 'apiKey', 'valid_api_key');
    }
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.log('配置错误:', error.message);
      console.log('需要配置:', error.details.configKey);
    }
  }
}

async function getConfiguration() {
  // 模拟配置获取
  return { apiKey: null };
}

// 示例10: 综合错误处理流程
export async function comprehensiveErrorHandlingExample() {
  console.log('=== 综合错误处理示例 ===');

  const service = new ExampleService();

  try {
    // 1. 参数验证
    console.log('1. 执行参数验证...');
    parameterValidationExample();

    // 2. 网络请求
    console.log('2. 执行网络请求...');
    await networkRequestWithRetryExample();

    // 3. API调用
    console.log('3. 执行API调用...');
    await apiCallExample();

    // 4. 存储操作
    console.log('4. 执行存储操作...');
    await storageOperationExample();

    // 5. 服务方法调用
    console.log('5. 执行服务方法...');
    const userData = await service.getUserData('test123');
    await service.saveUserData('test123', userData);

    // 6. 错误统计
    console.log('6. 查看错误统计...');
    await errorStatsExample();

    console.log('综合示例执行完成');
  } catch (error) {
    console.error('综合示例执行失败:', error.message);
  }
}

// 运行所有示例的函数
export async function runAllExamples() {
  console.log('开始运行所有错误处理示例...\n');

  await basicErrorHandlingExample();
  await networkRequestWithRetryExample();
  await apiCallExample();
  await storageOperationExample();
  parameterValidationExample();
  await errorStatsExample();
  await timeoutHandlingExample();
  await configurationErrorExample();
  await comprehensiveErrorHandlingExample();

  console.log('\n所有示例运行完成！');
}
