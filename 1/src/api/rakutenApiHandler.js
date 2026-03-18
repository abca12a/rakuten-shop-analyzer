/**
 * 乐天API处理器
 * 封装所有对乐天Web Service API的HTTP请求
 * 使用统一的错误处理机制
 */

import {
  ApiError,
  NetworkError,
  defaultErrorHandler as errorHandler,
} from '../utils/errorHandler.js';
import { enhancedFetch } from './connectionStabilizer.js';

const RAKUTEN_PROXY_BASE_URL = 'https://api.845817074.xyz';

// 统一API错误处理类（继承自统一错误处理系统）
class RakutenApiError extends ApiError {
  constructor(message, code = 'API_ERROR', details = null) {
    super(message, null, details);
    this.name = 'RakutenApiError';
    this.code = code;
  }
}

// 增强的API错误处理工具
const ApiErrorHandler = {
  // 处理API响应错误
  handleApiResponse(response, operation) {
    if (!response.ok) {
      const errorCode = this._getHttpErrorCode(response.status);
      const error = new RakutenApiError(
        `${operation} API请求失败，状态码: ${response.status}`,
        errorCode,
        {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
        }
      );

      // 记录详细的HTTP错误信息
      errorHandler.handleError(error, operation, false);
      throw error;
    }
    return response;
  },

  // 处理API数据错误
  handleApiData(data, operation) {
    if (data.error) {
      const errorCode = this._getApiErrorCode(data);
      const error = new RakutenApiError(
        `${operation}失败: ${data.error_description || data.message || data.error}`,
        errorCode,
        data
      );

      // 记录API业务逻辑错误
      errorHandler.handleError(error, operation, false);
      throw error;
    }
    return data;
  },

  // 创建标准化错误响应对象
  createErrorResponse(error, operation, additionalData = {}) {
    return errorHandler.createErrorResponse(error, operation, additionalData);
  },

  // 创建标准化成功响应对象
  createSuccessResponse(data, operation, additionalData = {}) {
    return errorHandler.createSuccessResponse(data, operation, additionalData);
  },

  // 获取HTTP状态码对应的错误代码
  _getHttpErrorCode(status) {
    if (status >= 500) return 'SERVER_ERROR';
    if (status === 429) return 'RATE_LIMIT_EXCEEDED';
    if (status === 404) return 'NOT_FOUND';
    if (status === 403) return 'FORBIDDEN';
    if (status === 401) return 'UNAUTHORIZED';
    if (status >= 400) return 'CLIENT_ERROR';
    return 'HTTP_ERROR';
  },

  // 获取API业务错误代码
  _getApiErrorCode(errorData) {
    const errorType = errorData.error;

    switch (errorType) {
      case 'not_found':
        return 'API_NOT_FOUND';
      case 'wrong_parameter':
        return 'API_WRONG_PARAMETER';
      case 'application_id_invalid':
        return 'API_INVALID_APP_ID';
      case 'quota_exceeded':
        return 'API_QUOTA_EXCEEDED';
      case 'rate_limit_exceeded':
        return 'API_RATE_LIMIT';
      default:
        return 'API_ERROR';
    }
  },
};

function _createRequestOptions() {
  return {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    mode: 'cors',
    cache: 'no-cache',
  };
}

function _normalizeRequestError(error, url) {
  if (error instanceof NetworkError) {
    return error;
  }

  if (error?.name === 'AbortError') {
    return new NetworkError('请求超时', url, 408);
  }

  if (
    error?.name === 'TypeError' ||
    error?.message?.includes('Failed to fetch') ||
    error?.message?.toLowerCase().includes('network')
  ) {
    return new NetworkError(
      error.message || '网络请求失败',
      url,
      0
    );
  }

  return error;
}

/**
 * 调用乐天楽天市場商品検索API (Rakuten Ichiba Item Search API)
 * @param {string} shopCode - 店铺代码
 * @param {number} page - 获取的页码
 * @returns {Promise<Object>} - API返回的JSON数据
 * @throws {RakutenApiError} - 如果API请求失败或返回错误
 */
export async function fetchShopItems(shopCode, page = 1) {
  // 参数验证
  errorHandler.validateParams(
    { shopCode, page },
    {
      shopCode: { required: true, type: 'string', minLength: 1 },
      page: { required: true, type: 'number' },
    }
  );

  return await errorHandler.executeWithRetry(
    async () => {
      const apiUrl = _buildApiUrl('IchibaItem/Search/20220601', {
        shopCode,
        formatVersion: 2,
        hits: 30,  // 🔧 修复：遵守API限制，每页最多30个商品
        page,
        imageFlag: 1,
        // 🔧 修复：不指定elements参数，获取所有字段包括分页信息
        // elements: 'itemName,itemCode,itemPrice,itemCaption,itemUrl,genreId,tagIds,availability,creditCardFlag,postageFlag,asurakuFlag,pointRate,reviewCount,reviewAverage,mediumImageUrls,smallImageUrls,shopName,shopCode,shopUrl,affiliateUrl,imageFlag,taxFlag,shipOverseasFlag,affiliateRate,startTime,endTime,giftFlag',
      });

      console.log(`正在请求API (IchibaItem/Search): ${apiUrl.toString()}`);

      let response;
      try {
        response = await enhancedFetch(
          apiUrl.toString(),
          _createRequestOptions(),
          {
            maxRetries: 4,
            baseDelay: 2000,
            maxDelay: 15000,
          }
        );
      } catch (error) {
        throw _normalizeRequestError(error, apiUrl.toString());
      }

      ApiErrorHandler.handleApiResponse(response, 'IchibaItem/Search');

      const data = await response.json();
      ApiErrorHandler.handleApiData(data, 'IchibaItem/Search');

      console.log('API响应成功 (IchibaItem/Search):', data);
      return data;
    },
    '获取店铺商品数据',
    {
      maxRetries: 2,
      retryDelay: 4000,
      retryCondition: error => {
        // 网络错误、超时或服务器错误可以重试
        return (
          error instanceof NetworkError ||
          error?.name === 'AbortError' ||
          error?.message?.includes('Failed to fetch') ||
          (error instanceof RakutenApiError &&
            ['SERVER_ERROR', 'RATE_LIMIT_EXCEEDED'].includes(error.code))
        );
      },
    }
  );
}

/**
 * 构建API URL的辅助函数
 * @param {string} endpoint - API端点
 * @param {Object} params - 查询参数
 * @returns {URL} 构建好的URL对象
 */
function _buildApiUrl(endpoint, params) {
  const apiUrl = new URL('/rakuten/proxy', `${RAKUTEN_PROXY_BASE_URL}/`);
  apiUrl.searchParams.append('endpoint', endpoint);
  Object.keys(params).forEach(key => {
    if (params[key] !== null && params[key] !== undefined) {
      apiUrl.searchParams.append(key, params[key]);
    }
  });
  return apiUrl;
}

/**
 * 通用API请求处理函数（使用统一错误处理）
 * @param {string} endpoint - API端点
 * @param {Object} params - 请求参数
 * @param {string} operationName - 操作名称（用于日志和错误）
 * @param {boolean} throwOnError - 是否在错误时抛出异常（默认true）
 * @returns {Promise<Object>} API响应数据或错误对象
 */
async function _makeApiRequest(
  endpoint,
  params,
  operationName,
  throwOnError = true
) {
  const operation = `API请求: ${operationName}`;

  // 如果不抛出异常，直接执行API调用，不使用ErrorHandler的重试机制
  if (!throwOnError) {
    try {
      const apiUrl = _buildApiUrl(endpoint, {
        ...params,
      });
      console.log(`正在请求API (${operationName}): ${apiUrl.toString()}`);

      const response = await enhancedFetch(
        apiUrl.toString(),
        _createRequestOptions(),
        {
          maxRetries: 0, // 不重试
          baseDelay: 1000,
          maxDelay: 5000,
        }
      );

      if (!response.ok) {
        // 返回错误对象而不抛出异常
        return {
          error: true,
          message: `HTTP ${response.status}: ${response.statusText}`,
          status: response.status,
          operationName: operationName,
        };
      }

      const data = await response.json();

      // 检查API数据，但不抛出异常
      try {
        ApiErrorHandler.handleApiData(data, operationName);
      } catch (apiError) {
        return {
          error: true,
          message: apiError.message || 'API数据验证失败',
          operationName: operationName,
          data: data,
        };
      }

      console.log(`API响应成功 (${operationName}):`, data);
      return data;
    } catch (error) {
      // 返回错误对象而不抛出异常
      return {
        error: true,
        message: error.message || 'API调用失败',
        operationName: operationName,
      };
    }
  }

  // 如果需要抛出异常，使用ErrorHandler
  try {
    return await errorHandler.wrapAsync(
      async () => {
        const apiUrl = _buildApiUrl(endpoint, {
          ...params,
        });
        console.log(`正在请求API (${operationName}): ${apiUrl.toString()}`);

        const response = await enhancedFetch(
          apiUrl.toString(),
          _createRequestOptions(),
          {
            maxRetries: 2,
            baseDelay: 1000,
            maxDelay: 5000,
          }
        );

        if (!response.ok) {
          throw new NetworkError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status
          );
        }

        const data = await response.json();
        ApiErrorHandler.handleApiData(data, operationName);

        console.log(`API响应成功 (${operationName}):`, data);
        return data;
      },
      operation,
      {
        throwOnError: throwOnError,
        defaultValue: null,
        errorCode: 'API_REQUEST_ERROR',
      }
    );
  } catch (error) {
    if (!throwOnError) {
      // 返回标准化错误响应
      return ApiErrorHandler.createErrorResponse(error, operationName, {
        endpoint: endpoint,
        params: params,
      });
    }

    // 重新抛出错误
    throw error;
  }
}

/**
 * 调用乐天楽天市場ジャンル検索API (Rakuten Ichiba Genre Search API)
 * @param {string|number} genreId - 分类ID (0 表示根分类)
 * @returns {Promise<Object>} - API返回的JSON数据或错误对象
 */
export async function fetchGenreDetails(genreId) {
  if (genreId === null || typeof genreId === 'undefined') {
    console.warn('fetchGenreDetails: genreId 未提供或无效');
    return { error: true, message: 'genreId 未提供或无效', genreId: genreId };
  }

  return await _makeApiRequest(
    'IchibaGenre/Search/20120723',
    {
      genreId: genreId.toString(),
      genrePath: 1,
      formatVersion: 2,
    },
    'IchibaGenre/Search',
    false // 不抛出异常，返回错误对象以保持向后兼容
  );
}

/**
 * 调用乐天楽天市場タグ検索API (Rakuten Ichiba Tag Search API)
 * @param {Array<number|string>} tagIds - 标签ID数组 (API限制最多10个)
 * @returns {Promise<Object>} - API返回的JSON数据或错误对象
 */
export async function fetchTagDetails(tagIds) {
  if (!tagIds || !Array.isArray(tagIds) || tagIds.length === 0) {
    console.warn('fetchTagDetails: tagIds 数组未提供、无效或为空');
    return {
      error: true,
      message: 'tagIds 数组未提供、无效或为空',
      tagIds: tagIds,
    };
  }

  // API限制最多10个ID，并过滤无效值
  const validTagIds = tagIds
    .slice(0, 10)
    .filter(id => id !== null && id !== undefined && id !== '')
    .map(id => String(id).trim())
    .filter(id => id.length > 0 && /^\d+$/.test(id)); // 只保留纯数字ID

  if (validTagIds.length === 0) {
    console.warn('fetchTagDetails: 没有有效的tagIds');
    return {
      error: true,
      message: '没有有效的tagIds',
      tagIds: tagIds,
    };
  }

  const tagIdString = validTagIds.join(',');
  console.log(`尝试获取标签详情，有效tagIds: ${tagIdString} (原始: ${tagIds.join(',')})`);

  // 尝试多个API版本
  const apiVersions = [
    'IchibaTag/Search/20140222', // 原版本
    'IchibaTag/Search/20220601', // 尝试新版本（如果存在）
  ];

  for (const apiVersion of apiVersions) {
    console.log(`尝试API版本: ${apiVersion}`);

    try {
      // 直接调用_makeApiRequest，不使用errorHandler.executeWithRetry
      const result = await _makeApiRequest(
        apiVersion,
        {
          tagId: tagIdString,
          formatVersion: 2,
        },
        'IchibaTag/Search',
        false // 不抛出异常，返回错误对象
      );

      // 如果成功获取数据，返回结果
      if (result && !result.error) {
        console.log(`✅ 标签API ${apiVersion} 调用成功`);
        return result;
      }

      // 如果是404错误，尝试下一个版本
      if (result && result.error && result.message && result.message.includes('404')) {
        console.log(`标签API ${apiVersion} 返回404，尝试下一个版本`);
        continue;
      }

      // 其他错误，返回结果
      return result;

    } catch (error) {
      console.log(`标签API ${apiVersion} 调用异常:`, error.message);

      // 如果是404错误，尝试下一个版本
      if (error.message && error.message.includes('404')) {
        continue;
      }

      // 其他错误，返回错误对象而不抛出异常
      return {
        error: true,
        message: error.message || '标签API调用失败',
        tagIds: tagIds,
      };
    }
  }

  // 所有版本都失败了
  console.log('❌ 所有标签API版本都失败了');
  return {
    error: true,
    message: '标签API不可用，可能已被废弃',
    tagIds: tagIds,
  };
}

/**
 * 调用乐天楽天市場ランキングAPI (Rakuten Ichiba Item Ranking API)
 * @param {string|number} genreId - 分类ID
 * @param {string} period - 排名周期 ('realtime', 'daily', 'weekly', 'monthly')
 * @returns {Promise<Object>} - API返回的排名数据或错误对象
 */
export async function fetchGenreRanking(genreId, period = 'realtime') {
  if (genreId === null || typeof genreId === 'undefined') {
    console.warn('fetchGenreRanking: genreId 未提供或无效');
    return { error: true, message: 'genreId 未提供或无效', genreId: genreId };
  }

  console.log(`尝试获取排名数据，genreId: ${genreId}, period: ${period}`);

  // 尝试多个API版本
  const apiVersions = [
    'IchibaItem/Ranking/20220601', // 较新版本
    'IchibaItem/Ranking/20170628', // 较旧版本
    'IchibaItem/Ranking/20140222', // 最旧版本
  ];

  for (const apiVersion of apiVersions) {
    console.log(`尝试排名API版本: ${apiVersion}`);

    try {
      // 直接调用_makeApiRequest，不使用errorHandler.executeWithRetry
      const result = await _makeApiRequest(
        apiVersion,
        {
          genreId: genreId.toString(),
          formatVersion: 2,
          period: period,
        },
        'IchibaItem/Ranking',
        false // 不抛出异常，返回错误对象
      );

      // 如果成功获取数据，返回结果
      if (result && !result.error) {
        console.log(`✅ 排名API ${apiVersion} 调用成功`);
        return result;
      }

      // 如果是404错误，尝试下一个版本
      if (result && result.error && result.message && result.message.includes('404')) {
        console.log(`排名API ${apiVersion} 返回404，尝试下一个版本`);
        continue;
      }

      // 其他错误，处理后返回
      if (result && result.error) {
        return _handleRankingError(result, genreId, period);
      }

      // 如果result为null或undefined，尝试下一个版本
      if (!result) {
        console.log(`排名API ${apiVersion} 请求失败，尝试下一个版本`);
        continue;
      }

      return result;

    } catch (error) {
      console.log(`排名API ${apiVersion} 调用异常:`, error.message);

      // 如果是404错误，尝试下一个版本
      if (error.message && error.message.includes('404')) {
        continue;
      }

      // 其他错误，如果是最后一个版本则返回错误
      if (apiVersion === apiVersions[apiVersions.length - 1]) {
        return {
          error: true,
          message: error.message || '排名API调用失败',
          genreId: genreId,
        };
      }
    }
  }

  // 所有版本都失败了
  console.log('❌ 所有排名API版本都失败了');
  return {
    error: true,
    errorType: 'no_ranking_data',
    message: '排名API不可用，可能已被废弃',
    genreId: genreId
  };
}

/**
 * 处理排名API的特殊错误情况
 */
function _handleRankingError(errorResult, genreId, period) {
  const details = errorResult.details;

  // 处理"分类不存在"错误
  if (
    details &&
    details.error === 'not_found' &&
    details.error_description === 'This genre data does not exist'
  ) {
    console.log(`分类ID ${genreId} 没有排名数据，这是正常情况。`);
    return {
      error: true,
      errorType: 'no_ranking_data',
      message: `分类ID ${genreId} 没有排名数据`,
      genreId: genreId,
    };
  }

  // 处理"参数错误"，尝试使用daily参数重新请求
  if (
    details &&
    details.error === 'wrong_parameter' &&
    details.error_description === 'set period from realtime' &&
    period !== 'daily'
  ) {
    console.log(`尝试使用daily参数重新请求 genreId: ${genreId}`);
    return fetchGenreRanking(genreId, 'daily');
  }

  return errorResult;
}

/**
 * 输出排名数据示例，帮助调试
 */
function _logRankingData(data, genreId) {
  if (data && data.Items && data.Items.length > 0) {
    console.log(`排名数据示例 - 分类 ${genreId}:`);
    console.log(`  - 排名名称: ${data.title || '无名称'}`);
    console.log(`  - 排名周期: ${data.period || 'unknown'}`);
    console.log(`  - 商品总数: ${data.Items.length}`);

    // 输出前3个排名商品的itemCode示例
    const sampleItems = data.Items.slice(0, 3);
    sampleItems.forEach((item, idx) => {
      if (item && item.itemCode) {
        console.log(
          `  - 排名#${idx + 1} 商品ID: ${item.itemCode}, 商品名: ${item.itemName || '无名称'}`
        );
      }
    });
  }
}

// 未来可以添加其他API的调用函数，例如：
// export async function fetchGenreDetails(genreId) { ... }
// export async function fetchTagDetails(tagId) { ... }
