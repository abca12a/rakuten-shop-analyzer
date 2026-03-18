/**
 * CSV导出模块
 * 负责处理CSV数据导出功能
 */

import { sendMessageToServiceWorker } from './messageHandler.js';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getProductsDataWithRetry(shopCode, maxAttempts = 8) {
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResponse = await sendMessageToServiceWorker(
      {
        action: 'getShopData',
        shopCode,
      },
      10000,
      3
    );

    if (
      lastResponse &&
      lastResponse.success &&
      Array.isArray(lastResponse.data) &&
      lastResponse.data.length > 0
    ) {
      return lastResponse;
    }

    // 抓取完成后数据可能刚落盘，给 batched storage 一个短暂缓冲时间
    if (attempt < maxAttempts) {
      await wait(1500 + attempt * 1500);
    }
  }

  return lastResponse;
}

// 专门的CSV导出函数
export async function exportShopDataToCSV(
  shopCode,
  updateStatus,
  summaryResultsArea,
  showLoading,
  hideLoading,
  clearSummary,
  updateImageStatus
) {
  const exportStartTime = Date.now();
  console.log(`[${exportStartTime}] === 开始CSV导出流程 ===`);
  console.log(`[${exportStartTime}] 目标店铺: ${shopCode}`);

  showLoading(true, '正在准备导出店铺 ' + shopCode + ' 的数据为CSV...');
  clearSummary();

  try {
    console.log(`[${Date.now()}] 开始导出店铺 ${shopCode} 的CSV数据`);

    // 第一步：获取商品基础数据（使用较短超时和更多重试）
    console.log(`[${Date.now()}] === 步骤1: 获取商品基础数据 ===`);
    console.log(`[${Date.now()}] 发送getShopData请求...`);

    const productsResponse = await getProductsDataWithRetry(shopCode);

    console.log(`[${Date.now()}] === 商品数据响应接收完成 ===`);
    console.log(`[${Date.now()}] 响应对象:`, productsResponse);
    console.log(`[${Date.now()}] 响应成功状态:`, productsResponse?.success);
    console.log(`[${Date.now()}] 响应数据存在:`, !!productsResponse?.data);
    console.log(
      `[${Date.now()}] 响应数据长度:`,
      productsResponse?.data?.length
    );

    if (!productsResponse || !productsResponse.success) {
      throw new Error(
        `无法获取店铺数据: ${productsResponse?.error || '未知错误'}`
      );
    }

    if (!productsResponse.data || productsResponse.data.length === 0) {
      throw new Error('店铺没有可导出的数据，请先抓取数据');
    }

    const productsData = productsResponse.data;
    console.log(`[${Date.now()}] 获取到 ${productsData.length} 个商品数据`);

    // 更新高分辨率图片状态（异步执行，不阻塞导出）
    updateImageStatus(shopCode);

    // 第二步：获取高分辨率图片数据（可选，失败不影响导出）
    console.log(`[${Date.now()}] === 步骤2: 获取高分辨率图片数据 ===`);
    let highResImagesData = {};

    try {
      const imageResponse = await sendMessageToServiceWorker(
        {
          action: 'getShopHighResImages',
          shopCode: shopCode,
        },
        8000,
        2
      ); // 8秒超时，重试2次

      console.log(`[${Date.now()}] 图片数据响应:`, imageResponse);

      if (imageResponse && imageResponse.success) {
        if (imageResponse.backgroundTask) {
          console.log(
            `[${Date.now()}] 图片数据查询在后台执行，使用空数据继续导出`
          );
        } else if (imageResponse.data) {
          highResImagesData = imageResponse.data;
          console.log(
            `[${Date.now()}] 获取到 ${Object.keys(highResImagesData).length} 个商品的图片数据`
          );
        } else {
          console.log(`[${Date.now()}] 未获取到图片数据，将使用空数据`);
        }
      } else {
        console.log(`[${Date.now()}] 图片数据获取失败，将使用空数据`);
      }
    } catch (imageError) {
      console.warn(
        `[${Date.now()}] 获取图片数据失败，继续导出基础数据:`,
        imageError
      );
    }

    // 第三步：合并数据
    console.log(`[${Date.now()}] === 步骤3: 合并商品和图片数据 ===`);
    productsData.forEach(product => {
      const itemCode = product.itemCode.split(':')[1] || product.itemCode;

      if (highResImagesData[itemCode]) {
        product.highResImageUrls = highResImagesData[itemCode].map(
          img => img.url
        );
        product.highResImageSizes = highResImagesData[itemCode].map(
          img => `${img.width}×${img.height}`
        );
        product.highResImageUrls_joined = product.highResImageUrls.join('\n');
        product.highResImageSizes_joined = product.highResImageSizes.join('\n');
      } else {
        product.highResImageUrls = [];
        product.highResImageSizes = [];
        product.highResImageUrls_joined = '';
        product.highResImageSizes_joined = '';
      }

      // 处理API中获取的图片
      if (product.mediumImageUrls) {
        product.mediumImageUrls_joined = product.mediumImageUrls.join('\n');
      }

      // 🔧 修复：确保商品描述字段正确处理
      if (!product.itemCaption) {
        product.itemCaption = ''; // 确保字段存在，即使为空
      }

      // 🔧 新增：处理文本化的标志字段
      product.availability_text = product.availability === 1 ? '有库存' : '无库存';
      product.creditCardFlag_text = product.creditCardFlag === 1 ? '支持' : '不支持';
      product.postageFlag_text = product.postageFlag === 0 ? '包邮' : '需付邮费';
      product.asurakuFlag_text = product.asurakuFlag === 1 ? '支持' : '不支持';
      product.giftFlag_text = product.giftFlag === 1 ? '支持' : '不支持';
      product.shipOverseasFlag_text = product.shipOverseasFlag === 1 ? '支持' : '不支持';
      product.taxFlag_text = product.taxFlag === 0 ? '含税' : '不含税';

      // 处理标签ID
      if (!product.tagIds_joined && product.tagIds) {
        product.tagIds_joined = product.tagIds.join(';');
      }
      if (!product.tagIds_joined) {
        product.tagIds_joined = '';
      }

      // 确保数值字段存在
      if (!product.pointRate) product.pointRate = 0;
      if (!product.reviewCount) product.reviewCount = 0;
      if (!product.reviewAverage) product.reviewAverage = 0;
      if (!product.affiliateRate) product.affiliateRate = 0;

      // 确保字符串字段存在
      if (!product.genreName) product.genreName = '';
      if (!product.affiliateUrl) product.affiliateUrl = '';
      if (!product.startTime) product.startTime = '';
      if (!product.endTime) product.endTime = '';
      if (!product.shopUrl) product.shopUrl = '';
    });

    // 第四步：转换为CSV
    console.log(`[${Date.now()}] === 步骤4: 转换数据为CSV格式 ===`);
    const csv = convertToCSV(productsData);
    if (!csv) {
      throw new Error('无法将数据转换为CSV格式');
    }
    console.log(`[${Date.now()}] CSV转换完成，数据长度: ${csv.length} 字符`);

    // 第五步：下载文件
    console.log(`[${Date.now()}] === 步骤5: 创建并下载CSV文件 ===`);
    const fileName = `${shopCode}_products_${new Date().toISOString().slice(0, 10)}.csv`;
    const blob = new Blob(['\ufeff' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    let link = null;

    try {
      link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);

      console.log(`[${Date.now()}] 触发文件下载: ${fileName}`);
      link.click();
    } finally {
      // 确保清理资源
      if (link && document.body.contains(link)) {
        document.body.removeChild(link);
      }
      URL.revokeObjectURL(url);
    }

    // 成功完成
    hideLoading();
    updateStatus(`成功导出店铺 ${shopCode} 的商品数据为CSV文件。`, 'success');

    // 显示导出摘要
    const imageCollectionStatus =
      Object.keys(highResImagesData).length > 0
        ? `已收集 ${Object.keys(highResImagesData).length} 个商品的高分辨率图片`
        : `未采集到高分辨率图片`;

    summaryResultsArea.innerHTML = `
            <div class="summary-card">
                <h3>导出成功</h3>
                <p>店铺: <b>${shopCode}</b></p>
                <p>总商品数: <b>${productsData.length}</b></p>
                <p>高分辨率图片: <b>${imageCollectionStatus}</b></p>
                <p>文件名: <b>${fileName}</b></p>
                <p class="info-message">✅ CSV文件已开始下载</p>
            </div>
        `;

    console.log(`[${Date.now()}] === CSV导出完成 ===`);
  } catch (error) {
    hideLoading();
    console.error(`[${Date.now()}] === 导出CSV时出错 ===`);
    console.error(`[${Date.now()}] 错误详情:`, error);
    console.error(`[${Date.now()}] 错误堆栈:`, error.stack);

    summaryResultsArea.innerHTML = `
            <div class="summary-card">
                <h3>导出失败</h3>
                <p style="color: #e74c3c;">错误: ${error.message}</p>
                <p class="info-message">请确保已经抓取了店铺数据，然后重试。</p>
                <p class="info-message">如果问题持续，请重新打开插件窗口。</p>
            </div>
        `;

    throw error;
  }
}

// CSV转换函数
function convertToCSV(dataArray) {
  if (!dataArray || dataArray.length === 0) return '';

  const headersMap = {
    shopCode: '店铺代码',
    itemCode: '商品代码',
    itemName: '商品名称',
    itemPrice: '商品价格',
    itemCaption: '商品描述',
    itemUrl: '商品链接',
    genreId: '分类ID',
    genreName: '分类名称',
    tagIds_joined: '标签ID',
    availability_text: '商品状态',
    creditCardFlag_text: '信用卡支付',
    postageFlag_text: '包邮标识',
    asurakuFlag_text: '翌日达标识',
    pointRate: '积分倍率',
    reviewCount: '评价数量',
    reviewAverage: '评价平均分',
    affiliateUrl: '联盟链接',
    affiliateRate: '联盟费率',
    startTime: '销售开始时间',
    endTime: '销售结束时间',
    giftFlag_text: '礼品包装',
    shipOverseasFlag_text: '海外配送',
    taxFlag_text: '税费标识',
    shopName: '店铺名称',
    shopUrl: '店铺链接',
    mediumImageUrls_joined: '图片链接',
    highResImageUrls_joined: '高分辨率图片URL(合并)',
    highResImageSizes_joined: '高分辨率图片尺寸(合并)',
    rakutenRank: '分类排名',
    rakutenRankCategory: '所属排名分类',
    rakutenRankStatus: '排名状态',
  };

  const columns = [
    'shopCode',
    'itemCode',
    'itemName',
    'itemPrice',
    'itemCaption',
    'itemUrl',
    'genreId',
    'genreName',
    'tagIds_joined',
    'availability_text',
    'creditCardFlag_text',
    'postageFlag_text',
    'asurakuFlag_text',
    'pointRate',
    'reviewCount',
    'reviewAverage',
    'affiliateUrl',
    'affiliateRate',
    'startTime',
    'endTime',
    'giftFlag_text',
    'shipOverseasFlag_text',
    'taxFlag_text',
    'shopName',
    'shopUrl',
    'mediumImageUrls_joined',
    'highResImageUrls_joined',
    'highResImageSizes_joined',
    'rakutenRank',
    'rakutenRankCategory',
    'rakutenRankStatus',
  ];

  const header = columns.map(col => headersMap[col] || col).join(',');

  const rows = dataArray.map(item => {
    return columns
      .map(column => {
        const value = item[column] !== undefined ? item[column] : '';

        if (
          typeof value === 'string' &&
          (value.includes(',') || value.includes('\n') || value.includes('"'))
        ) {
          return '"' + value.replace(/"/g, '""') + '"';
        }
        return value;
      })
      .join(',');
  });

  return header + '\n' + rows.join('\n');
}
