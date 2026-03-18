// 导入优化工具
import { optimizedStorageManager } from '../utils/optimizedDataProcessor.js';

const HIGH_RES_IMAGES_KEY = 'highResImages';
const BATCH_IMAGE_URL_DATA_PREFIX = 'batchImageUrlData_';

/**
 * 将指定店铺的商品数据保存到 chrome.storage.local。
 * 数据将以 shopCode 为键进行存储。
 * 优化版本：支持大数据分批存储和存储空间检查
 * @param {string} shopCode - 店铺代码。
 * @param {Array<Object>} products - 要保存的商品对象数组。
 * @returns {Promise<void>}
 */
export async function saveProducts(shopCode, products) {
  if (!shopCode || !products) {
    console.error('saveProducts: shopCode 和 products 不能为空');
    return;
  }
  try {
    console.log(
      `[dataManager] 开始保存店铺 ${shopCode} 的 ${products.length} 个商品（优化版本）`
    );

    // 检查存储空间
    await checkStorageSpace();

    // 如果数据量较大，使用分批存储
    if (products.length > 100) {
      console.log(
        `[dataManager] 数据量较大 (${products.length} 个商品)，使用分批存储`
      );

      // 🔧 修复：分批保存前先清除旧的直接存储数据
      console.log(`[dataManager] 清除旧的直接存储数据: ${shopCode}`);
      await chrome.storage.local.remove(shopCode);

      await optimizedStorageManager.saveBatched(
        shopCode,
        products,
        progress => {
          console.log(
            `[dataManager] 保存进度: ${progress.batch}/${progress.total} 批次`
          );
        }
      );

      console.log(
        `[dataManager] 分批保存完成，店铺 ${shopCode} 的 ${products.length} 个商品已保存`
      );
    } else {
      // 数据量较小，直接保存
      const dataToStore = { [shopCode]: products };
      await chrome.storage.local.set(dataToStore);
      console.log(
        `[dataManager] 直接保存完成，店铺 ${shopCode} 的 ${products.length} 个商品已保存`
      );
    }
  } catch (error) {
    console.error(`保存店铺 ${shopCode} 的数据时出错:`, error);

    // 如果是存储空间不足，尝试清理
    if (error.message && error.message.includes('QUOTA_EXCEEDED')) {
      console.log('[dataManager] 存储空间不足，尝试清理旧数据');
      await cleanupOldData();
      throw new Error('存储空间不足，已清理部分旧数据，请重试');
    }

    throw error;
  }
}

/**
 * 检查存储空间使用情况
 */
async function checkStorageSpace() {
  try {
    const usage = await chrome.storage.local.getBytesInUse();
    const quota = chrome.storage.local.QUOTA_BYTES || 5242880; // 5MB默认配额
    const usagePercent = (usage / quota) * 100;

    console.log(`[dataManager] 存储使用情况: ${usage} / ${quota} bytes (${usagePercent.toFixed(1)}%)`);

    if (usagePercent > 80) {
      console.warn('[dataManager] 存储空间使用超过80%，建议清理');
      if (usagePercent > 95) {
        throw new Error('存储空间不足，请清理数据');
      }
    }
  } catch (error) {
    console.warn('[dataManager] 检查存储空间失败:', error);
  }
}

/**
 * 清理旧数据
 */
async function cleanupOldData() {
  try {
    console.log('[dataManager] 开始清理旧数据');

    // 获取所有存储的键
    const allData = await chrome.storage.local.get();
    const keys = Object.keys(allData);

    // 清理高分辨率图片数据（通常占用较多空间）
    if (allData[HIGH_RES_IMAGES_KEY]) {
      const shopCodes = Object.keys(allData[HIGH_RES_IMAGES_KEY]);
      if (shopCodes.length > 5) {
        // 只保留最近的5个店铺的图片数据
        const keysToKeep = shopCodes.slice(-5);
        const cleanedImages = {};
        keysToKeep.forEach(key => {
          cleanedImages[key] = allData[HIGH_RES_IMAGES_KEY][key];
        });

        await chrome.storage.local.set({ [HIGH_RES_IMAGES_KEY]: cleanedImages });
        console.log(`[dataManager] 清理了 ${shopCodes.length - 5} 个店铺的图片数据`);
      }
    }

    // 清理批次数据索引
    const batchKeys = keys.filter(key => key.includes('_batch_') || key.includes('_index'));
    if (batchKeys.length > 0) {
      await chrome.storage.local.remove(batchKeys);
      console.log(`[dataManager] 清理了 ${batchKeys.length} 个批次数据`);
    }

  } catch (error) {
    console.error('[dataManager] 清理旧数据失败:', error);
  }
}

/**
 * 根据店铺代码从 chrome.storage.local 检索商品数据。
 * 优化版本：支持分批数据加载
 * @param {string} shopCode - 店铺代码。
 * @returns {Promise<Array<Object>|null>} - 返回商品对象数组，如果找不到则返回 null。
 */
export async function getProductsByShop(shopCode) {
  if (!shopCode) {
    console.error('getProductsByShop: shopCode 不能为空');
    return null;
  }
  try {
    console.log(`[dataManager] 开始获取店铺 ${shopCode} 的数据（优化版本）`);

    // 首先尝试直接获取
    const result = await chrome.storage.local.get(shopCode);
    if (result && result[shopCode]) {
      console.log(
        `[dataManager] 直接获取到店铺 ${shopCode} 的 ${result[shopCode].length} 个商品`
      );
      return result[shopCode];
    }

    // 如果直接获取失败，尝试分批加载
    console.log(
      `[dataManager] 直接获取失败，尝试分批加载店铺 ${shopCode} 的数据`
    );
    const batchedData = await optimizedStorageManager.loadBatched(
      shopCode,
      progress => {
        console.log(
          `[dataManager] 加载进度: ${progress.batch}/${progress.total} 批次`
        );
      }
    );

    if (batchedData && batchedData.length > 0) {
      console.log(
        `[dataManager] 分批加载成功，获取到店铺 ${shopCode} 的 ${batchedData.length} 个商品`
      );
      return batchedData;
    }

    console.log(`[dataManager] 存储中未找到店铺 ${shopCode} 的数据`);
    return null;
  } catch (error) {
    console.error(`获取店铺 ${shopCode} 数据时出错:`, error);
    throw error;
  }
}

/**
 * 从 chrome.storage.local 中清除指定店铺的商品数据。
 * 优化版本：支持清理分批存储的数据
 * @param {string} shopCode - 店铺代码。
 * @returns {Promise<void>}
 */
export async function clearShopData(shopCode) {
  if (!shopCode) {
    console.error('clearShopData: shopCode 不能为空');
    return;
  }
  try {
    console.log(`[dataManager] 开始清除店铺 ${shopCode} 的数据（优化版本）`);

    // 🔧 修复：先检查要清除的数据
    const existingData = await getProductsByShop(shopCode);
    const productCount = existingData ? existingData.length : 0;

    // 清除直接存储的数据
    await chrome.storage.local.remove(shopCode);

    // 清除分批存储的数据
    await optimizedStorageManager.cleanupBatches(shopCode);

    // 清除高分辨率图片数据
    await clearShopHighResImages(shopCode);

    // 清除批量图片抓取URL数据
    await clearBatchImageUrlData(shopCode);

    // 清理旧版本遗留的批量图片抓取数据
    const legacyBatchImageKey = `batchImageData_${shopCode}`;
    await chrome.storage.local.remove(legacyBatchImageKey);

    console.log(`[dataManager] 店铺 ${shopCode} 的所有数据已从存储中清除`);
    console.log(`[dataManager] 清除详情：商品数据 ${productCount} 个，图片数据，批量抓取数据`);

    return {
      success: true,
      clearedItems: {
        products: productCount,
        highResImages: true,
        batchImageData: true
      }
    };
  } catch (error) {
    console.error(`清除店铺 ${shopCode} 数据时出错:`, error);
    throw error;
  }
}

/**
 * 清除 chrome.storage.local 中的所有插件数据。
 * 谨慎使用此功能。
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  try {
    await chrome.storage.local.clear();
    console.log('所有插件数据已从 chrome.storage.local 清除。');
  } catch (error) {
    console.error('清除所有插件数据时出错:', error);
    throw error;
  }
}

/**
 * 保存商品的高分辨率图片信息
 * @param {string} shopCode - 店铺代码
 * @param {string} itemCode - 商品代码
 * @param {Array} images - 图片数组，每个元素包含url、width和height属性
 * @returns {Promise<boolean>} - 操作是否成功
 */
export async function saveHighResImages(shopCode, itemCode, images) {
  try {
    console.log(`[dataManager] 开始保存商品 ${itemCode} 的高分辨率图片信息`);

    // 获取当前存储的高分辨率图片数据
    const result = await chrome.storage.local.get(HIGH_RES_IMAGES_KEY);
    const highResImagesData = result[HIGH_RES_IMAGES_KEY] || {};

    // 如果没有该店铺的数据，创建一个对象
    if (!highResImagesData[shopCode]) {
      console.log(`[dataManager] 为店铺 ${shopCode} 创建新的高分辨率图片存储`);
      highResImagesData[shopCode] = {};
    }

    // 保存或更新该商品的图片数据
    highResImagesData[shopCode][itemCode] = images;

    // 保存回存储
    await chrome.storage.local.set({ [HIGH_RES_IMAGES_KEY]: highResImagesData });
    console.log(
      `[dataManager] 已保存 ${images.length} 张商品 ${itemCode} 的高分辨率图片`
    );
    return true;
  } catch (error) {
    console.error(`[dataManager] 保存高分辨率图片信息时出错:`, error);
    throw error;
  }
}

/**
 * 获取特定商品的高分辨率图片信息
 * @param {string} shopCode - 店铺代码
 * @param {string} itemCode - 商品代码
 * @returns {Promise<Object|null>} - 图片数据对象或null
 */
export async function getHighResImages(shopCode, itemCode) {
  try {
    console.log(`[dataManager] 尝试获取商品 ${itemCode} 的高分辨率图片数据`);
    // 获取所有高分辨率图片数据
    const result = await chrome.storage.local.get(HIGH_RES_IMAGES_KEY);
    const highResImagesData = result[HIGH_RES_IMAGES_KEY] || {};

    // 检查是否有该店铺的数据
    if (!highResImagesData[shopCode]) {
      console.log(`[dataManager] 未找到店铺 ${shopCode} 的高分辨率图片数据`);
      return null;
    }

    // 检查是否有该商品的数据
    if (!highResImagesData[shopCode][itemCode]) {
      console.log(`[dataManager] 未找到商品 ${itemCode} 的高分辨率图片数据`);
      return null;
    }

    // 返回该商品的图片数据
    const images = highResImagesData[shopCode][itemCode];
    console.log(
      `[dataManager] 找到商品 ${itemCode} 的 ${images.length} 张高分辨率图片`
    );

    return {
      success: true,
      images: images,
    };
  } catch (error) {
    console.error(`[dataManager] 获取高分辨率图片数据时出错:`, error);
    throw error;
  }
}

/**
 * 获取店铺所有商品的高分辨率图片
 * @param {string} shopCode - 店铺代码
 * @returns {Promise<Object|null>} - 店铺所有商品的高分辨率图片数据
 */
export async function getShopHighResImages(shopCode) {
  try {
    console.log(`[dataManager] 获取店铺 ${shopCode} 的所有高分辨率图片数据`);
    // 获取存储中的高分辨率图片数据
    const result = await chrome.storage.local.get(HIGH_RES_IMAGES_KEY);
    const highResImagesData = result[HIGH_RES_IMAGES_KEY] || {};

    // 检查是否有该店铺的数据
    if (!highResImagesData[shopCode]) {
      console.log(`[dataManager] 未找到店铺 ${shopCode} 的高分辨率图片数据`);
      return null;
    }

    console.log(
      `[dataManager] 找到店铺 ${shopCode} 的高分辨率图片数据，共 ${Object.keys(highResImagesData[shopCode]).length} 个商品`
    );

    // 返回该店铺的所有商品图片数据
    return highResImagesData[shopCode];
  } catch (error) {
    console.error(`[dataManager] 获取店铺高分辨率图片数据时出错:`, error);
    throw error;
  }
}

/**
 * 清除店铺的高分辨率图片信息
 * @param {string} shopCode - 店铺代码
 * @returns {Promise<boolean>} - 操作是否成功
 */
export async function clearShopHighResImages(shopCode) {
  try {
    console.log(`[dataManager] 开始清除店铺 ${shopCode} 的高分辨率图片数据`);
    const result = await chrome.storage.local.get(HIGH_RES_IMAGES_KEY);
    const highResImagesData = result[HIGH_RES_IMAGES_KEY] || {};

    if (highResImagesData[shopCode]) {
      delete highResImagesData[shopCode];
      await chrome.storage.local.set({ [HIGH_RES_IMAGES_KEY]: highResImagesData });
      console.log(`[dataManager] 店铺 ${shopCode} 的高分辨率图片信息已清除`);
    } else {
      console.log(
        `[dataManager] 店铺 ${shopCode} 没有高分辨率图片数据需要清除`
      );
    }

    return true;
  } catch (error) {
    console.error('[dataManager] 清除店铺高分辨率图片信息时出错:', error);
    throw error;
  }
}

/**
 * 保存店铺的批量图片URL数据
 * @param {string} shopCode - 店铺代码
 * @param {Array<Object>} imageUrlData - 图片URL数据
 * @returns {Promise<boolean>}
 */
export async function saveBatchImageUrlData(shopCode, imageUrlData) {
  try {
    if (!shopCode) {
      throw new Error('shopCode 不能为空');
    }

    const storageKey = `${BATCH_IMAGE_URL_DATA_PREFIX}${shopCode}`;
    await chrome.storage.local.set({
      [storageKey]: {
        updatedAt: Date.now(),
        data: Array.isArray(imageUrlData) ? imageUrlData : [],
      },
    });

    console.log(
      `[dataManager] 已保存店铺 ${shopCode} 的批量图片URL数据，商品数: ${
        Array.isArray(imageUrlData) ? imageUrlData.length : 0
      }`
    );
    return true;
  } catch (error) {
    console.error('[dataManager] 保存批量图片URL数据失败:', error);
    throw error;
  }
}

/**
 * 获取店铺的批量图片URL数据
 * @param {string} shopCode - 店铺代码
 * @returns {Promise<Array<Object>|null>}
 */
export async function loadBatchImageUrlData(shopCode) {
  try {
    if (!shopCode) {
      throw new Error('shopCode 不能为空');
    }

    const storageKey = `${BATCH_IMAGE_URL_DATA_PREFIX}${shopCode}`;
    const result = await chrome.storage.local.get(storageKey);
    const storedValue = result[storageKey];

    if (!storedValue) {
      return null;
    }

    if (Array.isArray(storedValue)) {
      return storedValue;
    }

    return Array.isArray(storedValue.data) ? storedValue.data : null;
  } catch (error) {
    console.error('[dataManager] 读取批量图片URL数据失败:', error);
    throw error;
  }
}

/**
 * 清除店铺的批量图片URL数据
 * @param {string} shopCode - 店铺代码
 * @returns {Promise<boolean>}
 */
export async function clearBatchImageUrlData(shopCode) {
  try {
    if (!shopCode) {
      throw new Error('shopCode 不能为空');
    }

    const storageKey = `${BATCH_IMAGE_URL_DATA_PREFIX}${shopCode}`;
    await chrome.storage.local.remove(storageKey);
    console.log(`[dataManager] 已清除店铺 ${shopCode} 的批量图片URL数据`);
    return true;
  } catch (error) {
    console.error('[dataManager] 清除批量图片URL数据失败:', error);
    throw error;
  }
}

// 监听存储变化的示例 (可选，用于调试或特定功能)
/*
chrome.storage.onChanged.addListener((changes, namespace) => {
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
        console.log(
            `存储键 "${key}" 在命名空间 "${namespace}" 中已更改。`,
            `旧值为:`, oldValue,
            `新值为:`, newValue
        );
    }
});
*/
