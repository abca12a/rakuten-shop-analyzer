// 导入依赖
import {
  fetchShopItems,
  fetchGenreDetails,
  fetchTagDetails,
  fetchGenreRanking,
} from '../src/api/rakutenApiHandler.js';
import { saveProducts } from '../src/core/dataManager.js';

// 统一错误处理类
class ScrapingError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', details = null) {
    super(message);
    this.name = 'ScrapingError';
    this.code = code;
    this.details = details;
  }
}

// 错误处理工具函数
const ErrorHandler = {
  // 包装异步函数，统一错误处理
  async wrapAsync(fn, errorCode, errorMessage) {
    try {
      return await fn();
    } catch (error) {
      console.error(`[${errorCode}] ${errorMessage}:`, error);
      throw new ScrapingError(
        `${errorMessage}: ${error.message}`,
        errorCode,
        error
      );
    }
  },

  // 处理API响应错误
  handleApiError(response, operation) {
    if (!response) {
      throw new ScrapingError(
        `${operation}失败: 未收到API响应`,
        'API_NO_RESPONSE'
      );
    }
    if (response.error) {
      throw new ScrapingError(
        `${operation}失败: ${response.message || response.error}`,
        'API_ERROR',
        response
      );
    }
    return response;
  },
};

// 商品数据抓取器
class ProductFetcher {
  constructor(shopCode, sendProgressToPopup, taskStatus) {
    this.shopCode = shopCode;
    this.sendProgressToPopup = sendProgressToPopup;
    this.taskStatus = taskStatus;
    this.maxPagesToFetch = 1000;  // 🔧 修复：大幅提高页数限制，支持大型店铺
    this.pageRequestSpacing = 1500;
  }

  async fetchAllProducts() {
    const allProducts = [];
    let currentPage = 1;
    let pageCount = 1;
    let pagesFetched = 0;

    await this.sendProgressToPopup(
      `[1/5] 开始为店铺 ${this.shopCode} 抓取商品数据...`
    );
    console.log(
      `开始为店铺 ${this.shopCode} 抓取商品、分类和标签信息... (shopScraper)`
    );

    // 🔧 修复：改进循环条件，确保至少尝试多页
    while (currentPage <= this.maxPagesToFetch) {
      // 检查是否需要停止
      if (this.taskStatus && this.taskStatus.shouldStop) {
        console.log('检测到停止信号，中断商品抓取');
        throw new Error('用户取消了抓取操作');
      }

      const pageData = await this._fetchSinglePage(currentPage, pageCount);

      if (pageData.items.length > 0) {
        allProducts.push(...pageData.items);
        pageCount = pageData.pageCount;
        pagesFetched++;
        console.log(
          `第 ${currentPage} 页处理完成，添加 ${pageData.items.length} 个商品`
        );

        // 🔧 修复：显示总进度信息
        if (pageData.totalCount > 0) {
          const progress = Math.round((allProducts.length / pageData.totalCount) * 100);
          console.log(`抓取进度: ${allProducts.length}/${pageData.totalCount} (${progress}%)`);
        }

        // 🔧 修复：如果当前页商品数量少于30，可能已到最后一页
        if (pageData.items.length < 30) {
          console.log(`第 ${currentPage} 页商品数量 (${pageData.items.length}) 少于30，可能已到最后一页`);
          break; // 提前结束循环
        }

        // 🔧 修复：检查是否已达到计算的总页数
        if (pageData.pageCount > 0 && currentPage >= pageData.pageCount) {
          console.log(`已达到总页数 ${pageData.pageCount}，停止抓取`);
          break;
        }

      } else if (pageData.isEmpty) {
        console.warn(`第 ${currentPage} 页数据为空，停止抓取`);
        break;
      } else {
        console.warn(`第 ${currentPage} 页没有商品，停止抓取`);
        break;
      }

      currentPage++;

      if (currentPage <= this.maxPagesToFetch) {
        await this._delay(this.pageRequestSpacing);
      }
    }

    await this._validateResults(allProducts, pagesFetched);
    return { products: allProducts, pagesFetched };
  }

  async _fetchSinglePage(currentPage, pageCount) {
    // 检查是否需要停止
    if (this.taskStatus && this.taskStatus.shouldStop) {
      console.log('检测到停止信号，中断页面抓取');
      throw new Error('用户取消了抓取操作');
    }

    await this.sendProgressToPopup(
      ` - 正在抓取商品第 ${currentPage} / ${pageCount === 1 && currentPage === 1 ? '多' : pageCount} 页...`
    );

    const productData = await ErrorHandler.wrapAsync(
      () => fetchShopItems(this.shopCode, currentPage),
      'FETCH_PRODUCTS_ERROR',
      `抓取第${currentPage}页商品数据`
    );

    this._logPageResponse(currentPage, productData);

    if (!productData || !productData.Items) {
      await this.sendProgressToPopup(
        `警告: 第 ${currentPage} 页商品数据获取异常或为空。`,
        'warning'
      );
      return { items: [], pageCount, isEmpty: true };
    }

    const validItems = this._validateAndFilterItems(
      productData.Items,
      currentPage
    );

    // 🔧 修复：正确计算分页信息（API限制每页最多30个商品）
    const totalCount = productData?.count || 0;
    const hitsPerPage = productData?.hits || 30;  // API限制最多30
    const calculatedPageCount = totalCount > 0 ? Math.ceil(totalCount / hitsPerPage) : pageCount;
    const finalPageCount = productData?.pageCount || calculatedPageCount;

    return {
      items: validItems,
      pageCount: finalPageCount,
      isEmpty: false,
      totalCount: totalCount,
    };
  }

  _logPageResponse(currentPage, productData) {
    // 🔧 修复：计算正确的分页信息（API限制每页最多30个商品）
    const totalCount = productData?.count || 0;
    const hitsPerPage = productData?.hits || 30;  // API限制最多30
    const calculatedPageCount = totalCount > 0 ? Math.ceil(totalCount / hitsPerPage) : 1;

    console.log(`第 ${currentPage} 页响应摘要:`, {
      count: totalCount,
      page: productData?.page || currentPage,
      pageCount: productData?.pageCount || calculatedPageCount,
      calculatedPageCount: calculatedPageCount,
      hitsPerPage: hitsPerPage,
      itemsExist: productData?.Items ? '存在' : '不存在',
      itemsLength: productData?.Items?.length || 'N/A',
      // 🔧 调试：输出原始API响应的关键字段
      rawCount: productData?.count,
      rawPageCount: productData?.pageCount,
      rawHits: productData?.hits,
      rawPage: productData?.page,
    });

    if (productData?.Items?.length > 0) {
      console.log(
        `第 ${currentPage} 页首个商品示例:`,
        JSON.stringify(productData.Items[0], null, 2)
      );
    }
  }

  _validateAndFilterItems(items, currentPage) {
    const validItems = [];

    for (const item of items) {
      if (item && typeof item === 'object' && item.itemCode) {
        validItems.push(item);
      } else {
        console.warn(
          `第 ${currentPage} 页发现无效商品数据:`,
          JSON.stringify(item, null, 2)
        );
      }
    }

    console.log(
      `第 ${currentPage} 页处理: ${items.length} 个原始商品，${validItems.length} 个有效商品`
    );
    return validItems;
  }

  async _validateResults(allProducts, pagesFetched) {
    await this.sendProgressToPopup(
      `[1/5] 商品基础数据抓取完成: ${allProducts.length}件商品, 共${pagesFetched}页。`,
      allProducts.length > 0 ? 'success' : 'warning'
    );

    if (allProducts.length === 0) {
      throw new ScrapingError(
        '未获取到任何商品数据，请检查店铺代码是否正确',
        'NO_PRODUCTS_FOUND'
      );
    }

    console.log(`商品抓取完成，总计: ${allProducts.length} 个商品`);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 分类信息处理器
class GenreProcessor {
  constructor(sendProgressToPopup, genreCache, taskStatus) {
    this.sendProgressToPopup = sendProgressToPopup;
    this.genreCache = genreCache;
    this.taskStatus = taskStatus;
  }

  async processGenres(products) {
    // 检查是否需要停止
    if (this.taskStatus && this.taskStatus.shouldStop) {
      console.log('检测到停止信号，中断分类处理');
      throw new Error('用户取消了抓取操作');
    }

    await this.sendProgressToPopup(
      `[2/5] 开始处理商品分类信息 (${products.length}件商品)...`
    );

    let processedCount = 0;
    for (const product of products) {
      // 每处理10个商品检查一次停止信号
      if (processedCount % 10 === 0 && this.taskStatus && this.taskStatus.shouldStop) {
        console.log('检测到停止信号，中断分类处理');
        throw new Error('用户取消了抓取操作');
      }

      processedCount++;

      if (product.genreId) {
        await this._processProductGenre(
          product,
          processedCount,
          products.length
        );
      }
    }

    await this.sendProgressToPopup(`[2/5] 商品分类信息处理完毕。`, 'success');
  }

  async _processProductGenre(product, processedCount, totalCount) {
    if (this.genreCache.has(product.genreId)) {
      product.rakutenGenrePath = this.genreCache.get(product.genreId);
      return;
    }

    // 显示进度（每10个或最后一个）
    if (this._shouldShowProgress(processedCount, totalCount)) {
      await this.sendProgressToPopup(
        ` - 处理分类: 商品 ${processedCount}/${totalCount} (ID: ${product.genreId})...`
      );
    }

    try {
      const genreDetails = await ErrorHandler.wrapAsync(
        () => fetchGenreDetails(product.genreId.toString()),
        'FETCH_GENRE_ERROR',
        `获取分类详情 (ID: ${product.genreId})`
      );

      const genrePath = this._buildGenrePath(genreDetails);
      product.rakutenGenrePath = genrePath;
      this.genreCache.set(product.genreId, genrePath);
    } catch (error) {
      product.rakutenGenrePath = '分类信息获取失败';
      console.warn(`获取 genreId ${product.genreId} 的分类详情失败:`, error);
      await this.sendProgressToPopup(
        `警告: 商品 ${this._getProductDisplayName(product)} 分类获取失败。`,
        'warning'
      );
    }
  }

  _buildGenrePath(genreDetails) {
    if (!genreDetails || genreDetails.error || !genreDetails.current) {
      return '分类信息获取失败';
    }

    let path = genreDetails.current.genreName;
    if (genreDetails.parents && genreDetails.parents.length > 0) {
      const parentPath = genreDetails.parents
        .map(p => p.genreName)
        .reverse()
        .join(' > ');
      path = `${parentPath} > ${path}`;
    }
    return path;
  }

  _shouldShowProgress(current, total) {
    return current % 10 === 1 || current === total || total < 10;
  }

  _getProductDisplayName(product) {
    return product.itemName
      ? product.itemName.substring(0, 15) + '...'
      : product.itemCode;
  }
}

// 标签信息处理器
class TagProcessor {
  constructor(sendProgressToPopup, tagDetailCache, taskStatus) {
    this.sendProgressToPopup = sendProgressToPopup;
    this.tagDetailCache = tagDetailCache;
    this.taskStatus = taskStatus;
  }

  async processTags(products) {
    // 检查是否需要停止
    if (this.taskStatus && this.taskStatus.shouldStop) {
      console.log('检测到停止信号，中断标签处理');
      throw new Error('用户取消了抓取操作');
    }

    await this.sendProgressToPopup(
      `[3/5] 开始处理商品标签信息 (${products.length}件商品)...`
    );

    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;

    for (const product of products) {
      // 每处理10个商品检查一次停止信号
      if (processedCount % 10 === 0 && this.taskStatus && this.taskStatus.shouldStop) {
        console.log('检测到停止信号，中断标签处理');
        throw new Error('用户取消了抓取操作');
      }

      processedCount++;

      if (product.tagIds && product.tagIds.length > 0) {
        const beforeTags = product.rakutenTags;
        await this._processProductTags(
          product,
          processedCount,
          products.length
        );

        // 统计成功和失败的数量
        if (product.rakutenTags &&
            !product.rakutenTags.includes('标签信息获取失败') &&
            !product.rakutenTags.includes('标签信息暂不可用')) {
          successCount++;
        } else {
          failedCount++;
        }
      } else {
        // 没有标签ID的商品
        product.rakutenTags = ['无标签信息'];
      }
    }

    const statusMessage = failedCount > 0
      ? `[3/5] 商品标签信息处理完毕 (成功: ${successCount}, 失败: ${failedCount})。`
      : `[3/5] 商品标签信息处理完毕。`;

    await this.sendProgressToPopup(statusMessage, failedCount > successCount ? 'warning' : 'success');
  }

  async _processProductTags(product, processedCount, totalCount) {
    const cacheKey = product.tagIds.slice().sort().join(',');

    if (this.tagDetailCache.has(cacheKey)) {
      product.rakutenTags = this.tagDetailCache.get(cacheKey);
      return;
    }

    // 显示进度
    if (this._shouldShowProgress(processedCount, totalCount)) {
      const tagPreview =
        product.tagIds.slice(0, 2).join(',') +
        (product.tagIds.length > 2 ? '...' : '');
      await this.sendProgressToPopup(
        ` - 处理标签: 商品 ${processedCount}/${totalCount} (IDs: ${tagPreview})...`
      );
    }

    try {
      // 直接调用API，不使用ErrorHandler的重试机制
      const tagDetails = await fetchTagDetails(product.tagIds);

      // 检查API响应
      if (tagDetails && tagDetails.error) {
        // 根据错误类型提供更具体的错误信息
        const errorType = this._getApiErrorType(tagDetails);
        const errorMessage = this._getApiErrorMessage(tagDetails, 'tags');
        
        console.log(`标签API返回错误 (tagIds: ${product.tagIds.join(',')}):`, tagDetails.message || tagDetails.error);
        
        // 根据错误类型设置不同的标签信息
        if (errorType === 'not_found') {
          product.rakutenTags = ['标签数据不存在'];
        } else if (errorType === 'deprecated') {
          product.rakutenTags = ['标签API已废弃'];
        } else if (errorType === 'rate_limit') {
          product.rakutenTags = ['API调用频率限制'];
        } else {
          product.rakutenTags = [`标签获取失败: ${errorMessage}`];
        }
        
        this.tagDetailCache.set(cacheKey, product.rakutenTags);
        return;
      }

      const formattedTags = this._formatTags(tagDetails);
      product.rakutenTags = formattedTags;
      this.tagDetailCache.set(cacheKey, formattedTags);
    } catch (error) {
      // 捕获异常，提供更详细的错误信息
      const errorMessage = this._getNetworkErrorMessage(error);
      product.rakutenTags = [`标签获取异常: ${errorMessage}`];
      this.tagDetailCache.set(cacheKey, product.rakutenTags);
      
      console.warn(
        `获取 tagIds ${product.tagIds.join(',')} 的标签详情失败:`,
        error.message || error
      );

      // 根据错误严重程度决定是否显示警告
      if (this._shouldShowApiError(error)) {
        await this.sendProgressToPopup(
          `警告: 商品 ${this._getProductDisplayName(product)} 标签获取失败: ${errorMessage}`,
          'warning'
        );
      }
    }
  }

  // 新增辅助方法：获取API错误类型
  _getApiErrorType(errorResponse) {
    if (!errorResponse || !errorResponse.error) return 'unknown';
    
    const errorCode = errorResponse.error;
    if (errorCode === 'not_found') return 'not_found';
    if (errorCode === 'wrong_parameter') return 'deprecated';
    if (errorCode === 'quota_exceeded' || errorCode === 'rate_limit_exceeded') return 'rate_limit';
    if (errorCode === 'application_id_invalid') return 'auth_error';
    
    return 'api_error';
  }

  // 新增辅助方法：获取API错误消息
  _getApiErrorMessage(errorResponse, apiType) {
    if (!errorResponse) return '未知错误';
    
    const errorCode = errorResponse.error;
    const errorDescription = errorResponse.error_description || errorResponse.message;
    
    switch (errorCode) {
      case 'not_found':
        return apiType === 'tags' ? '标签不存在' : '数据不存在';
      case 'wrong_parameter':
        return 'API参数错误(可能已废弃)';
      case 'quota_exceeded':
        return 'API配额已用完';
      case 'rate_limit_exceeded':
        return 'API调用频率过高';
      case 'application_id_invalid':
        return 'API密钥无效';
      default:
        return errorDescription || errorCode || '未知API错误';
    }
  }

  // 新增辅助方法：获取网络错误消息
  _getNetworkErrorMessage(error) {
    if (!error) return '未知网络错误';
    
    const message = error.message || error.toString();
    
    if (message.includes('fetch')) return '网络请求失败';
    if (message.includes('timeout')) return '请求超时';
    if (message.includes('CORS')) return '跨域请求被阻止';
    if (message.includes('DNS')) return 'DNS解析失败';
    if (message.includes('SSL') || message.includes('TLS')) return 'SSL证书错误';
    
    return message.substring(0, 50); // 限制错误消息长度
  }

  // 新增辅助方法：判断是否应该显示API错误
  _shouldShowApiError(error) {
    if (!error || !error.message) return true;
    
    const message = error.message.toLowerCase();
    
    // 这些错误通常是预期的，不需要显示给用户
    if (message.includes('404')) return false;
    if (message.includes('not_found')) return false;
    if (message.includes('wrong_parameter')) return false;
    
    return true;
  }

  _formatTags(tagDetails) {
    if (
      !tagDetails ||
      tagDetails.error ||
      !tagDetails.tagGroups ||
      tagDetails.tagGroups.length === 0
    ) {
      return ['无有效标签信息'];
    }

    const formattedTags = [];
    tagDetails.tagGroups.forEach(group => {
      if (
        group.TagGroup &&
        group.TagGroup.tags &&
        group.TagGroup.tags.length > 0
      ) {
        group.TagGroup.tags.forEach(tag => {
          if (tag.Tag && tag.Tag.tagName) {
            formattedTags.push(
              `${group.TagGroup.tagGroupName}: ${tag.Tag.tagName}`
            );
          }
        });
      }
    });

    return formattedTags.length > 0 ? formattedTags : ['无有效标签信息'];
  }

  _shouldShowProgress(current, total) {
    return current % 10 === 1 || current === total || total < 10;
  }

  _getProductDisplayName(product) {
    return product.itemName
      ? product.itemName.substring(0, 15) + '...'
      : product.itemCode;
  }
}

// 排名信息处理器
class RankingProcessor {
  constructor(shopCode, sendProgressToPopup, taskStatus, options = {}) {
    this.shopCode = shopCode;
    this.sendProgressToPopup = sendProgressToPopup;
    this.taskStatus = taskStatus;
    this.rankingCache = new Map();
    this.options = this._buildOptions(options);
    this.BATCH_SIZE = this.options.batchSize;
    this.BATCH_DELAY = this.options.batchDelay;
    this.REQUEST_DELAY = this.options.requestDelay;
    this.failureThreshold = this.options.failureThreshold;
    this.consecutiveFailures = 0;
    this.isCircuitOpen = false;
    this.circuitOpenReason = '';
    this.stats = {
      totalGenres: 0,
      successCount: 0,
      noDataCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };
  }

  async processRankings(products) {
    // 检查是否需要停止
    if (this.taskStatus && this.taskStatus.shouldStop) {
      console.log('检测到停止信号，中断排名处理');
      throw new Error('用户取消了抓取操作');
    }

    await this.sendProgressToPopup(`[4/6] 开始获取商品排名信息...`);

    const productsByGenre = this._groupProductsByGenre(products);
    const genreIds = Object.keys(productsByGenre);
    this.stats.totalGenres = genreIds.length;

    await this.sendProgressToPopup(
      ` - 发现 ${genreIds.length} 个不同商品分类`,
      'info'
    );

    if (genreIds.length === 0) {
      await this.sendProgressToPopup(`[4/6] 未发现可用于排名的商品分类。`, 'info');
      return;
    }

    await this.sendProgressToPopup(
      ` - 排名模式: ${this.options.mode === 'safe' ? '安全模式(单分类慢速+连续失败熔断)' : '标准模式'}`,
      'info'
    );

    // 批量处理分类排名
    await this._processBatchRankings(genreIds, productsByGenre);

    const summaryMessage =
      `[4/6] 商品排名信息处理完毕 ` +
      `(成功: ${this.stats.successCount}, 无数据: ${this.stats.noDataCount}, ` +
      `失败: ${this.stats.failedCount}, 跳过: ${this.stats.skippedCount})。`;
    const summaryLevel =
      this.stats.failedCount > 0 || this.stats.skippedCount > 0 ? 'warning' : 'success';
    await this.sendProgressToPopup(summaryMessage, summaryLevel);
  }

  _buildOptions(options) {
    const mode = options.mode === 'normal' ? 'normal' : 'safe';

    if (mode === 'normal') {
      return {
        mode,
        batchSize: 2,
        batchDelay: 2000,
        requestDelay: 500,
        failureThreshold: 6,
      };
    }

    return {
      mode,
      batchSize: 1,
      batchDelay: 4500,
      requestDelay: 1500,
      failureThreshold: 3,
    };
  }

  _groupProductsByGenre(products) {
    const productsByGenre = {};
    for (const product of products) {
      if (product.genreId) {
        if (!productsByGenre[product.genreId]) {
          productsByGenre[product.genreId] = [];
        }
        productsByGenre[product.genreId].push(product);
      }
    }
    return productsByGenre;
  }

  async _processBatchRankings(genreIds, productsByGenre) {
    const totalGenres = genreIds.length;

    for (let i = 0; i < totalGenres; i += this.BATCH_SIZE) {
      // 检查是否需要停止
      if (this.taskStatus && this.taskStatus.shouldStop) {
        console.log('检测到停止信号，中断排名批次处理');
        throw new Error('用户取消了抓取操作');
      }

      if (this.isCircuitOpen) {
        await this._skipRemainingGenres(
          genreIds.slice(i),
          productsByGenre,
          this.circuitOpenReason || '排名接口连续失败，已自动跳过剩余分类'
        );
        break;
      }

      const batchGenreIds = genreIds.slice(i, i + this.BATCH_SIZE);
      const batchNumber = Math.floor(i / this.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalGenres / this.BATCH_SIZE);

      await this.sendProgressToPopup(
        ` - 处理排名批次 ${batchNumber}/${totalBatches} (分类ID: ${batchGenreIds.join(', ')})...`
      );

      // 获取排名数据
      await this._fetchRankingDataForBatch(batchGenreIds);

      // 应用排名数据到商品
      await this._applyRankingDataToBatch(batchGenreIds, productsByGenre);

      if (this.isCircuitOpen && i + this.BATCH_SIZE < totalGenres) {
        await this._skipRemainingGenres(
          genreIds.slice(i + this.BATCH_SIZE),
          productsByGenre,
          this.circuitOpenReason || '排名接口连续失败，已自动跳过剩余分类'
        );
        break;
      }

      // 批次间延迟
      if (i + this.BATCH_SIZE < totalGenres) {
        // 在延迟期间也检查停止信号
        await this.sendProgressToPopup(
          ` - 正在等待API冷却时间 (${this.BATCH_DELAY / 1000}秒)...`,
          'info'
        );

        // 分段延迟，每500ms检查一次停止信号
        const delaySteps = Math.ceil(this.BATCH_DELAY / 500);
        for (let step = 0; step < delaySteps; step++) {
          if (this.taskStatus && this.taskStatus.shouldStop) {
            console.log('检测到停止信号，中断延迟等待');
            throw new Error('用户取消了抓取操作');
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  }

  async _fetchRankingDataForBatch(genreIds) {
    for (const genreId of genreIds) {
      if (this.rankingCache.has(genreId)) continue;
      if (this.isCircuitOpen) break;

      try {
        // 直接调用API，不使用ErrorHandler的重试机制
        const rankingData = await fetchGenreRanking(genreId);
        await this._handleRankingResponse(genreId, rankingData);
        if (!this.isCircuitOpen) {
          await this._delay(this.REQUEST_DELAY);
        }
      } catch (error) {
        const errorType = this._inferErrorTypeFromException(error);
        const errorMessage = this._getNetworkErrorMessage(error);
        console.log('获取排名数据时出错 (genreId: ' + genreId + '):', error.message || error);
        this.rankingCache.set(
          genreId,
          this._createNoRankingEntry(genreId, {
            error: errorMessage,
            errorType,
            rankStatus: this._getRankStatusForError(errorType, errorMessage),
          })
        );
        await this._registerFailure(genreId, errorType, errorMessage);

        // 根据错误类型决定是否显示详细信息
        if (this._shouldShowApiError(error)) {
          await this.sendProgressToPopup(
            `- 分类 ${genreId} 排名获取失败: ${errorMessage}`,
            'warning'
          );
        }
      }
    }
  }

  async _handleRankingResponse(genreId, rankingData) {
    if (!rankingData || rankingData.error) {
      const errorType = rankingData ? this._getApiErrorType(rankingData) : 'no_response';
      const errorMessage = rankingData ? this._getApiErrorMessage(rankingData, 'ranking') : '无响应数据';
      const rankStatus = this._getRankStatusForError(errorType, errorMessage);
      this.rankingCache.set(
        genreId,
        this._createNoRankingEntry(genreId, {
          error: errorMessage,
          errorType,
          rankStatus,
          title: rankingData?.title,
        })
      );

      // 根据错误类型显示不同的消息
      if (this._isExpectedRankingError(errorType)) {
        this.consecutiveFailures = 0;
        this.stats.noDataCount++;
      } else {
        await this._registerFailure(genreId, errorType, errorMessage);
      }

      if (errorType === 'not_found' || errorType === 'no_ranking_data') {
        await this.sendProgressToPopup(`- 分类 ${genreId} 无排名数据(正常现象)`, 'info');
      } else if (errorType === 'deprecated') {
        await this.sendProgressToPopup(`- 分类 ${genreId} 排名接口不支持，已跳过`, 'info');
      } else if (!this._isExpectedRankingError(errorType)) {
        await this.sendProgressToPopup(`- 分类 ${genreId} 排名获取失败: ${errorMessage}`, 'warning');
      }
    } else {
      this.rankingCache.set(genreId, rankingData);
      this.consecutiveFailures = 0;
      this.stats.successCount++;
      await this.sendProgressToPopup('- 成功获取分类 ' + genreId + ' 的排名数据', 'success');
    }
  }

  // 新增辅助方法：判断是否为预期的排名错误
  _isExpectedRankingError(errorType) {
    return ['not_found', 'no_response', 'deprecated', 'no_ranking_data'].includes(errorType);
  }

  async _applyRankingDataToBatch(genreIds, productsByGenre) {
    for (const genreId of genreIds) {
      const productsInGenre = productsByGenre[genreId] || [];
      const rankingData = this.rankingCache.get(genreId);

      if (!rankingData) continue;

      if (rankingData.noRankingData) {
        this._applyNoRankingData(productsInGenre, rankingData);
      } else if (
        rankingData.error ||
        !rankingData.Items ||
        !rankingData.Items.length
      ) {
        this._applyErrorRankingData(productsInGenre, rankingData, genreId);
      } else {
        this._applyValidRankingData(productsInGenre, rankingData, genreId);
      }
    }
  }

  _applyNoRankingData(products, rankingData) {
    products.forEach(product => {
      product.rakutenRank = null;
      product.rakutenRankCategory =
        rankingData.title || `分类ID: ${product.genreId}`;
      product.rakutenRankingUrl = null;
      product.rakutenRankStatus = rankingData.rankStatus || '此分类无排名数据';
      product.rakutenRankItemCount = 0;
    });
  }

  _applyErrorRankingData(products, rankingData, genreId) {
    products.forEach(product => {
      product.rakutenRank = null;
      product.rakutenRankCategory = rankingData?.title || `分类ID: ${genreId}`;
      product.rakutenRankingUrl = null;
      product.rakutenRankStatus = rankingData?.rankStatus ||
        (rankingData?.error ? '获取排名失败' : '无排名数据');
      product.rakutenRankItemCount = 0;
    });
  }

  _applyValidRankingData(products, rankingData, genreId) {
    const rankingUrl = rankingData.lastBuildDate
      ? `https://ranking.rakuten.co.jp/${rankingData.period || 'realtime'}/${genreId}/`
      : null;
    const rankItemCount = rankingData.Items.length;

    const topRankItems = this._buildTopRankItemsString(rankingData.Items);
    const rankMap = this._buildRankMap(rankingData.Items);

    let matchedCount = 0;
    for (const product of products) {
      const matchResult = this._findProductRank(product, rankMap);

      product.rakutenRankCategory = rankingData.title || `分类ID: ${genreId}`;
      product.rakutenRankingUrl = rankingUrl;
      product.rakutenRankItemCount = rankItemCount;
      product.rakutenRankTopItems = topRankItems;

      if (matchResult.found) {
        matchedCount++;
        product.rakutenRank = matchResult.rank;
        product.rakutenRankStatus = '已排名';
        product.rakutenRankMatchedId = matchResult.matchedId;
      } else {
        product.rakutenRank = null;
        product.rakutenRankStatus = '同类中未上榜';
      }
    }

    console.log(
      `分类 ${genreId} (${rankingData.title || '未知分类名称'}) 中 ${products.length} 个商品，成功匹配排名 ${matchedCount} 个`
    );
  }

  _getApiErrorType(errorResponse) {
    if (!errorResponse) return 'no_response';

    if (errorResponse.errorType === 'no_ranking_data') return 'no_ranking_data';

    const errorCode = errorResponse.error;
    if (!errorCode) return 'unknown';

    if (errorCode === 'not_found') return 'not_found';
    if (errorCode === 'wrong_parameter') return 'deprecated';
    if (
      errorCode === 'quota_exceeded' ||
      errorCode === 'rate_limit_exceeded'
    ) {
      return 'rate_limit';
    }
    if (errorCode === 'application_id_invalid') return 'auth_error';
    if (errorCode === 'service_unavailable') return 'service_unavailable';

    return 'api_error';
  }

  _getApiErrorMessage(errorResponse, apiType) {
    if (!errorResponse) return '未知错误';

    const errorCode = errorResponse.error;
    const errorDescription =
      errorResponse.error_description || errorResponse.message;

    switch (errorCode) {
      case 'not_found':
        return apiType === 'ranking' ? '此分类暂无排名数据' : '数据不存在';
      case 'wrong_parameter':
        return 'API参数错误(可能已废弃)';
      case 'quota_exceeded':
        return 'API配额已用完';
      case 'rate_limit_exceeded':
        return 'API调用频率过高';
      case 'application_id_invalid':
        return 'API凭证无效';
      case 'service_unavailable':
        return '服务暂时不可用，请稍后重试';
      default:
        return errorDescription || errorCode || '未知API错误';
    }
  }

  _createNoRankingEntry(genreId, overrides = {}) {
    return {
      noRankingData: true,
      title: overrides.title || `分类ID: ${genreId}`,
      error: overrides.error || null,
      errorType: overrides.errorType || 'no_ranking_data',
      rankStatus: overrides.rankStatus || '此分类无排名数据',
    };
  }

  async _registerFailure(genreId, errorType, errorMessage) {
    const shouldTripImmediately = errorType === 'auth_error';
    const countsTowardBreaker = this._countsTowardCircuitBreaker(errorType);

    this.stats.failedCount++;

    if (!countsTowardBreaker) {
      this.consecutiveFailures = 0;
      return;
    }

    this.consecutiveFailures++;

    if (shouldTripImmediately || this.consecutiveFailures >= this.failureThreshold) {
      this.isCircuitOpen = true;
      this.circuitOpenReason =
        shouldTripImmediately
          ? `分类 ${genreId} 排名凭证异常，已跳过剩余分类`
          : `分类 ${genreId} 起连续 ${this.consecutiveFailures} 次排名失败，已跳过剩余分类`;
      await this.sendProgressToPopup(
        `- ${this.circuitOpenReason} (${errorMessage})`,
        'warning'
      );
    }
  }

  _countsTowardCircuitBreaker(errorType) {
    return [
      'rate_limit',
      'network_error',
      'service_unavailable',
      'api_error',
      'auth_error',
      'unknown',
    ].includes(errorType);
  }

  async _skipRemainingGenres(genreIds, productsByGenre, reason) {
    if (!genreIds.length) return;

    for (const genreId of genreIds) {
      if (!this.rankingCache.has(genreId)) {
        this.rankingCache.set(
          genreId,
          this._createNoRankingEntry(genreId, {
            error: reason,
            errorType: 'circuit_open',
            rankStatus: '排名阶段已自动降级跳过',
          })
        );
        this.stats.skippedCount++;
      }
    }

    await this._applyRankingDataToBatch(genreIds, productsByGenre);
    await this.sendProgressToPopup(`- ${reason}`, 'warning');
  }

  _buildTopRankItemsString(items) {
    if (!items || items.length === 0) return '';

    const topThree = items.slice(0, Math.min(3, items.length));
    return topThree
      .map(
        (item, idx) =>
          `${idx + 1}. ${item.itemName ? item.itemName.substring(0, 20) + '...' : '未知商品'} (${item.shopName || '未知店铺'})`
      )
      .join('|');
  }

  _buildRankMap(items) {
    const rankMap = new Map();

    items.forEach((item, index) => {
      if (item && item.itemCode) {
        const rank = index + 1;
        rankMap.set(item.itemCode, rank);

        // 处理带冒号的itemCode
        if (item.itemCode.includes(':')) {
          const parts = item.itemCode.split(':');
          if (parts.length > 1) {
            rankMap.set(parts[1], rank);
          }
        }

        // 处理店铺前缀
        const fullShopPrefix = this.shopCode + ':';
        if (item.itemCode.startsWith(fullShopPrefix)) {
          rankMap.set(item.itemCode.substring(fullShopPrefix.length), rank);
        }

        // 处理纯数字itemCode
        if (/^\d+$/.test(item.itemCode)) {
          rankMap.set(item.itemCode, rank);
        }
      }
    });

    return rankMap;
  }

  _findProductRank(product, rankMap) {
    // 直接匹配
    if (rankMap.has(product.itemCode)) {
      return {
        found: true,
        rank: rankMap.get(product.itemCode),
        matchedId: product.itemCode,
      };
    }

    // 处理带冒号的itemCode
    if (product.itemCode && product.itemCode.includes(':')) {
      const parts = product.itemCode.split(':');
      if (parts.length > 1 && rankMap.has(parts[1])) {
        return {
          found: true,
          rank: rankMap.get(parts[1]),
          matchedId: parts[1],
        };
      }
    } else {
      // 尝试添加店铺前缀
      const fullId = `${this.shopCode}:${product.itemCode}`;
      if (rankMap.has(fullId)) {
        return { found: true, rank: rankMap.get(fullId), matchedId: fullId };
      }
    }

    // 从URL中提取itemCode
    if (product.itemUrl) {
      const urlMatch = this._extractItemCodeFromUrl(product.itemUrl, rankMap);
      if (urlMatch.found) return urlMatch;
    }

    // 从商品名称或描述中提取SKU
    if (product.itemName || product.catchcopy) {
      const skuMatch = this._extractSkuFromText(
        product.itemName || product.catchcopy || '',
        rankMap
      );
      if (skuMatch.found) return skuMatch;
    }

    return { found: false };
  }

  _extractItemCodeFromUrl(itemUrl, rankMap) {
    try {
      const urlObj = new URL(itemUrl);
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      if (pathParts.length >= 2) {
        const possibleItemCode = pathParts[pathParts.length - 1];
        if (possibleItemCode && rankMap.has(possibleItemCode)) {
          return {
            found: true,
            rank: rankMap.get(possibleItemCode),
            matchedId: possibleItemCode,
          };
        }
      }
    } catch (e) {
      console.log(`解析商品URL失败: ${itemUrl}`, e);
    }
    return { found: false };
  }

  _extractSkuFromText(text, rankMap) {
    const skuMatch = text.match(/(\d{7,15})/);
    if (skuMatch && skuMatch[1]) {
      const possibleSku = skuMatch[1];
      if (rankMap.has(possibleSku)) {
        return {
          found: true,
          rank: rankMap.get(possibleSku),
          matchedId: possibleSku,
        };
      }
    }
    return { found: false };
  }

  // 🔧 修复：添加缺失的辅助方法
  _getNetworkErrorMessage(error) {
    if (!error) return '未知网络错误';

    const message = error.message || error.toString();

    if (message.includes('fetch')) return '网络请求失败';
    if (message.toLowerCase().includes('timeout')) return '请求超时';
    if (message.includes('CORS')) return '跨域请求被阻止';
    if (message.includes('DNS')) return 'DNS解析失败';
    if (message.includes('SSL') || message.includes('TLS')) return 'SSL证书错误';
    if (message.includes('429')) return '请求过于频繁';
    if (message.includes('503')) return '服务暂时不可用';

    return message.substring(0, 50); // 限制错误消息长度
  }

  _inferErrorTypeFromException(error) {
    const message = (error?.message || error?.toString() || '').toLowerCase();

    if (message.includes('429') || message.includes('rate limit') || message.includes('quota')) {
      return 'rate_limit';
    }
    if (message.includes('503') || message.includes('temporarily unavailable')) {
      return 'service_unavailable';
    }
    if (message.includes('401') || message.includes('403') || message.includes('application')) {
      return 'auth_error';
    }
    if (
      message.includes('fetch') ||
      message.includes('timeout') ||
      message.includes('dns') ||
      message.includes('network')
    ) {
      return 'network_error';
    }

    return 'api_error';
  }

  _getRankStatusForError(errorType, errorMessage) {
    switch (errorType) {
      case 'not_found':
      case 'no_ranking_data':
        return '此分类无排名数据';
      case 'deprecated':
        return '排名接口不支持此分类';
      case 'rate_limit':
      case 'service_unavailable':
        return '排名接口限流，已跳过';
      case 'circuit_open':
        return '排名阶段已自动降级跳过';
      case 'auth_error':
        return '排名接口认证失败';
      case 'network_error':
        return '排名接口网络异常';
      default:
        return errorMessage ? `排名获取失败: ${errorMessage}` : '获取排名失败';
    }
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _shouldShowApiError(error) {
    if (!error || !error.message) return true;

    const message = error.message.toLowerCase();

    // 过滤掉一些预期的错误，不显示给用户
    if (message.includes('404') && message.includes('not found')) return false;
    if (message.includes('no ranking data')) return false;
    if (message.includes('api deprecated')) return false;

    return true;
  }
}

export async function executeScrapeShop(
  shopCode,
  fetchRanking,
  fetchTags,
  rankingOptions,
  taskStatus,
  saveTaskStatus,
  sendProgressToPopup,
  showNotification
) {
  const genreCache = new Map();
  const tagDetailCache = new Map();

  // 简单的进度跟踪器
  const progressTracker = {
    totalSteps: fetchRanking ? 6 : 5,
    currentStep: 0,

    updateProgress(stepName) {
      this.currentStep++;
      const percent = Math.round((this.currentStep / this.totalSteps) * 100);

      // 发送真实的进度更新到popup
      try {
        chrome.runtime.sendMessage({
          action: 'updateScrapeProgress',
          progress: percent,
          step: stepName,
          current: this.currentStep,
          total: this.totalSteps
        });
      } catch (error) {
        // 忽略popup未打开的错误
        console.log(`进度更新: ${percent}% - ${stepName}`);
      }
    }
  };

  try {
    // 检查是否需要停止
    if (taskStatus.shouldStop) {
      throw new Error('用户取消了抓取操作');
    }

    // 1. 抓取所有商品数据
    progressTracker.updateProgress('正在抓取商品数据...');
    const productFetcher = new ProductFetcher(
      shopCode,
      sendProgressToPopup,
      taskStatus
    );
    const { products: allProducts, pagesFetched } =
      await productFetcher.fetchAllProducts();

    // 检查是否需要停止
    if (taskStatus.shouldStop) {
      throw new Error('用户取消了抓取操作');
    }

    // 2. 处理商品分类信息
    progressTracker.updateProgress('正在处理分类信息...');
    const genreProcessor = new GenreProcessor(
      sendProgressToPopup,
      genreCache,
      taskStatus
    );
    await genreProcessor.processGenres(allProducts);

    // 检查是否需要停止
    if (taskStatus.shouldStop) {
      throw new Error('用户取消了抓取操作');
    }

    // 3. 处理商品标签信息
    if (fetchTags) {
      progressTracker.updateProgress('正在处理标签信息...');
      const tagProcessor = new TagProcessor(
        sendProgressToPopup,
        tagDetailCache,
        taskStatus
      );
      await tagProcessor.processTags(allProducts);
    } else {
      progressTracker.updateProgress('跳过标签信息...');
      await sendProgressToPopup(
        `[3/5] 已跳过获取商品标签信息(用户选择)。`,
        'info'
      );
      allProducts.forEach(product => {
        product.rakutenTags = ['标签信息已跳过'];
      });
    }

    // 检查是否需要停止
    if (taskStatus.shouldStop) {
      throw new Error('用户取消了抓取操作');
    }

    // 4. 处理商品排名信息
    if (fetchRanking) {
      progressTracker.updateProgress('正在处理排名信息...');
      const rankingProcessor = new RankingProcessor(
        shopCode,
        sendProgressToPopup,
        taskStatus,
        rankingOptions
      );
      await rankingProcessor.processRankings(allProducts);
    } else {
      progressTracker.updateProgress('跳过排名信息...');
      await sendProgressToPopup(
        `[4/6] 已跳过获取商品排名信息(用户选择)。`,
        'info'
      );
      allProducts.forEach(product => {
        product.rakutenRank = null;
        product.rakutenRankCategory = null;
        product.rakutenRankingUrl = null;
      });
    }

    // 检查是否需要停止
    if (taskStatus.shouldStop) {
      throw new Error('用户取消了抓取操作');
    }

    // 5. 保存所有数据
    progressTracker.updateProgress('正在保存数据...');
    await _saveProductData(
      shopCode,
      allProducts,
      sendProgressToPopup,
      taskStatus
    );

    // 6. 完成任务
    progressTracker.updateProgress('抓取完成');
    const result = await _completeTask(
      shopCode,
      allProducts,
      pagesFetched,
      taskStatus,
      saveTaskStatus,
      showNotification,
      sendProgressToPopup
    );
    return result;
  } catch (error) {
    return await _handleTaskError(
      error,
      shopCode,
      taskStatus,
      saveTaskStatus,
      showNotification,
      sendProgressToPopup
    );
  }
}

// 数据保存处理器
async function _saveProductData(
  shopCode,
  allProducts,
  sendProgressToPopup,
  taskStatus
) {
  // 检查是否需要停止
  if (taskStatus && taskStatus.shouldStop) {
    throw new Error('用户取消了抓取操作');
  }

  await sendProgressToPopup(`[5/6] 开始保存数据到本地存储...`);
  console.log(`即将保存 ${allProducts.length} 个商品数据`);

  if (allProducts.length > 0) {
    console.log(
      '商品数据示例 (前3个):',
      JSON.stringify(allProducts.slice(0, 3), null, 2)
    );
  }

  await ErrorHandler.wrapAsync(
    () => saveProducts(shopCode, allProducts),
    'SAVE_PRODUCTS_ERROR',
    '保存商品数据到本地存储'
  );

  await sendProgressToPopup(`[5/6] 所有数据已成功保存到本地!`, 'success');
}

// 任务完成处理器
async function _completeTask(
  shopCode,
  allProducts,
  pagesFetched,
  taskStatus,
  saveTaskStatus,
  showNotification,
  sendProgressToPopup
) {
  console.log(`店铺 ${shopCode} 的所有数据已成功抓取、处理和保存。`);
  await sendProgressToPopup(
    `[6/6] 数据抓取和处理已完成。总共抓取了${allProducts.length}个商品。`,
    'success'
  );

  // 发送最终进度更新到popup
  try {
    chrome.runtime.sendMessage({
      action: 'updateScrapeProgress',
      progress: 100,
      step: '抓取完成',
      current: 6,
      total: 6,
      completed: true // 标记任务完成
    });
  } catch (error) {
    console.log('发送完成进度更新失败:', error.message);
  }

  // 更新任务状态 - 确保状态正确设置
  taskStatus.inProgress = false;
  taskStatus.lastTaskCompleted = true;
  taskStatus.lastTaskResult = {
    success: true, // 明确标记成功
    itemCount: allProducts.length,
    pagesFetched: pagesFetched,
    timestamp: new Date().toISOString(),
  };
  taskStatus.lastTaskError = null; // 清除之前的错误
  await saveTaskStatus();

  // 显示通知
  showNotification(
    '店铺数据抓取完成',
    `店铺 ${shopCode} 的数据已成功抓取，共 ${allProducts.length} 个商品。`,
    'basic'
  );

  return {
    success: true,
    itemCount: allProducts.length,
    pagesFetched: pagesFetched,
    products: allProducts,
  };
}

// 任务错误处理器
async function _handleTaskError(
  error,
  shopCode,
  taskStatus,
  saveTaskStatus,
  showNotification,
  sendProgressToPopup
) {
  console.error(`抓取店铺 ${shopCode} 的数据时出错:`, error);

  // 更新任务状态
  taskStatus.inProgress = false;
  taskStatus.lastTaskCompleted = false;
  taskStatus.lastTaskError = error.message || '抓取过程中发生未知错误';
  await saveTaskStatus();

  // 显示通知和错误信息
  const errorMessage =
    error instanceof ScrapingError
      ? error.message
      : error.message || '未知错误';

  showNotification(
    '店铺数据抓取失败',
    `店铺 ${shopCode} 的数据抓取失败：${errorMessage}`,
    'basic'
  );

  sendProgressToPopup(`错误: ${errorMessage}`, 'error');

  return {
    success: false,
    error: errorMessage,
    errorCode: error instanceof ScrapingError ? error.code : 'UNKNOWN_ERROR',
  };
}
