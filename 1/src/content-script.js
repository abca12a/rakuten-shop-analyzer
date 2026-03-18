/**
 * 🚀 快速模式：利用网页中已加载的图片，避免重复下载
 * @returns {Promise<Array>} 已加载图片的数据数组
 */
async function extractImagesFromLoadedContent() {
  console.log('[图片提取] 🚀 开始快速提取已加载的图片内容...');

  return new Promise(resolve => {
    const loadedImages = [];
    const imgElements = document.querySelectorAll('img');
    let processedCount = 0;

    console.log(`[图片提取] 页面上共找到 ${imgElements.length} 个<img>标签`);

    if (imgElements.length === 0) {
      console.log('[图片提取] 页面上没有图片，直接返回空数组');
      resolve([]);
      return;
    }

    // 🔧 快速处理：直接使用已加载的图片
    imgElements.forEach((img, index) => {
      try {
        // 检查图片是否已经加载完成
        if (img.complete && img.naturalWidth > 0) {
          const imageData = extractImageDataFromElement(img, index);
          if (imageData) {
            loadedImages.push(imageData);
          }
        }
        processedCount++;

        // 如果处理完所有图片，返回结果
        if (processedCount === imgElements.length) {
          console.log(`[图片提取] 🎉 快速提取完成，共找到 ${loadedImages.length} 张已加载图片`);
          resolve(loadedImages);
        }
      } catch (error) {
        console.warn(`[图片提取] 处理已加载图片 ${index} 时出错:`, error);
        processedCount++;

        if (processedCount === imgElements.length) {
          resolve(loadedImages);
        }
      }
    });
  });
}

/**
 * 🔧 从图片元素中提取数据（用于快速模式）
 */
function extractImageDataFromElement(img, index) {
  try {
    const src = img.src;
    const alt = img.alt || '';
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    // 过滤掉太小的图片（可能是图标或装饰图片）
    if (width < 100 || height < 100) {
      return null;
    }

    // 过滤掉明显的UI元素
    if (src.includes('icon') || src.includes('button') || src.includes('logo')) {
      return null;
    }

    // 🔧 创建Canvas并提取图片数据
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;

    try {
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

      return {
        url: src,
        dataUrl: dataUrl, // 🔧 包含实际图片数据
        width: width,
        height: height,
        alt: alt,
        filename: generateFilename(src, index),
        size: Math.round(dataUrl.length * 0.75), // 估算文件大小
        type: 'loaded_content'
      };
    } catch (error) {
      // 如果无法提取Canvas数据（跨域等），返回基本信息
      console.warn(`[图片提取] 无法提取图片 ${index} 的Canvas数据:`, error);
      return {
        url: src,
        width: width,
        height: height,
        alt: alt,
        filename: generateFilename(src, index),
        type: 'url_only'
      };
    }
  } catch (error) {
    console.warn(`[图片提取] 提取图片数据失败:`, error);
    return null;
  }
}

/**
 * 🔧 生成文件名
 */
function generateFilename(url, index) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();

    if (filename && filename.includes('.')) {
      return filename;
    } else {
      // 如果无法从URL获取文件名，生成一个
      const extension = url.toLowerCase().includes('.gif') ? 'gif' : 'jpg';
      return `image_${index + 1}.${extension}`;
    }
  } catch (error) {
    return `image_${index + 1}.jpg`;
  }
}

/**
 * 从商品详情页提取高分辨率图片
 * @returns {Promise<Array>} 高分辨率图片URL数组
 */
async function extractHighResImages() {
  console.log('[图片提取] 开始尝试提取页面上的高分辨率图片...');
  return new Promise(resolve => {
    const highResImages = [];
    const imgElements = document.querySelectorAll('img');
    let processedCount = 0;
    const maxConcurrent = 5; // 限制并发处理数量
    let currentConcurrent = 0;
    const imageQueue = Array.from(imgElements);
    const processedImages = new Set(); // 防止重复处理

    console.log(`[图片提取] 页面上共找到 ${imgElements.length} 个<img>标签`);

    if (imgElements.length === 0) {
      console.log('[图片提取] 页面上没有图片，直接返回空数组');
      resolve([]);
      return;
    }

    // 统计信息
    let rakutenImageCount = 0;
    let goldShopImageCount = 0;
    let nonRakutenImageCount = 0;
    let errorImages = 0;
    let smallImages = 0;
    let largeImages = 0;

    // 优先检查所有DOM上可能的大图
    const possibleLargeImagePatterns = [
      // 针对物品详情页的大图特征
      /item\/[^/]+\/.*\/[^/]+_[^_]+\.jpg/i, // 例如：...item/商品ID/images/商品图_01.jpg
      /cabinet\/.+\/[^/]+_[a-z][0-9]+\.jpg/i, // 例如：...cabinet/目录/商品_a1.jpg
      /cabinet\/.+\/[^/]+_[0-9]+\.jpg/i, // 例如：...cabinet/目录/商品_01.jpg
    ];

    // 处理每个图片，检查尺寸
    imgElements.forEach((img, index) => {
      const src = img.src;

      // 处理楽天相关的图片源
      if (!src) {
        console.log(`[图片提取] 图片 #${index}: 无src属性`);
        processedCount++;
        nonRakutenImageCount++;
        if (processedCount === imgElements.length) {
          logExtractSummary();
          resolve(highResImages);
        }
        return;
      }

      // 检查是否是楽天相关的图片源
      const isRakutenImage =
        src.includes('image.rakuten.co.jp') ||
        src.includes('rakuten.ne.jp/gold/') ||
        src.includes('www.rakuten.ne.jp/gold/');

      if (!isRakutenImage) {
        console.log(
          `[图片提取] 图片 #${index}: 不是乐天图片源，已跳过: ${src.substring(0, 100)}...`
        );
        processedCount++;
        nonRakutenImageCount++;
        if (processedCount === imgElements.length) {
          logExtractSummary();
          resolve(highResImages);
        }
        return;
      }

      // 标记图片源类型
      const imageSourceType = src.includes('image.rakuten.co.jp')
        ? 'CDN图片'
        : src.includes('rakuten.ne.jp/gold/') ||
            src.includes('www.rakuten.ne.jp/gold/')
          ? '金店铺图片'
          : '其他楽天图片';
      console.log(
        `[图片提取] 图片 #${index}: 检测到${imageSourceType}: ${src.substring(0, 100)}...`
      );

      // 检查是否是缩略图，尝试构建大图URL
      let bigImageUrl = src;
      const isGoldShopImage =
        src.includes('rakuten.ne.jp/gold/') ||
        src.includes('www.rakuten.ne.jp/gold/');

      if (isGoldShopImage) {
        // 金店铺图片特殊处理
        console.log(
          `[图片提取] 图片 #${index}: 金店铺图片，直接使用原URL: ${src.substring(0, 100)}...`
        );
        bigImageUrl = src;
      } else {
        // 普通CDN图片处理
        // 如果是128x128或64x64的缩略图，尝试获取原始图像
        if (src.includes('?_ex=128x128') || src.includes('?_ex=64x64')) {
          bigImageUrl = src.split('?')[0];
          console.log(
            `[图片提取] 图片 #${index}: 检测到是缩略图，尝试查找大图: ${bigImageUrl}`
          );
        }
        // 根据URL特征推测是否可能是大图
        else {
          let isPossibleLargeImage = false;
          for (const pattern of possibleLargeImagePatterns) {
            if (pattern.test(src)) {
              isPossibleLargeImage = true;
              break;
            }
          }
          if (isPossibleLargeImage) {
            console.log(
              `[图片提取] 图片 #${index}: 根据URL特征可能是大图: ${src.substring(0, 100)}...`
            );
          }
        }
      }

      rakutenImageCount++;
      if (isGoldShopImage) {
        goldShopImageCount++;
      }
      console.log(
        `[图片提取] 图片 #${index}: 正在检查尺寸: ${bigImageUrl.substring(0, 100)}...`
      );

      // 创建一个Image对象来获取图片真实尺寸
      const tempImg = new Image();

      // 对于金店铺图片，设置跨域属性
      if (isGoldShopImage) {
        tempImg.crossOrigin = 'anonymous';
      }

      tempImg.onload = function () {
        // 记录所有图片尺寸，方便调试
        console.log(
          `[图片提取] 图片 #${index}: 尺寸 ${this.width}x${this.height}, URL: ${bigImageUrl.substring(0, 100)}...`
        );

        // 对于金店铺图片，如果无法获取尺寸，使用启发式判断
        let shouldInclude = false;
        let estimatedWidth = this.width;
        let estimatedHeight = this.height;

        if (isGoldShopImage && (this.width === 0 || this.height === 0)) {
          // 金店铺图片可能因为跨域无法获取真实尺寸，使用URL特征判断
          console.log(
            `[图片提取] 图片 #${index}: 金店铺图片无法获取尺寸，使用启发式判断`
          );

          // 检查文件名是否包含大图特征 - 改进版
          const filename = bigImageUrl.split('/').pop().toLowerCase();
          const urlLower = bigImageUrl.toLowerCase();
          
          // 扩展启发式判断规则
          const largeImagePatterns = [
            // 文件名大图标识
            /_l\./,           // _l.jpg
            /_large\./,       // _large.jpg  
            /_big\./,         // _big.jpg
            /_main\./,        // _main.jpg
            /_detail\./,      // _detail.jpg
            /_original\./,    // _original.jpg
            /_high\./,        // _high.jpg
            /_hd\./,          // _hd.jpg
            /_full\./,        // _full.jpg
            /lp/,             // LP页面图片
            /banner/,         // banner图片
            /hero/,           // hero图片
            /slide/,          // 轮播图
            /carousel/,       // 轮播图
            // 尺寸信息模式
            /\d{3,4}x\d{3,4}/, // 包含尺寸信息如 1200x800
            /\d{4,}/,         // 4位以上数字可能是尺寸
          ];

          // 目录路径特征
          const largeImagePaths = [
            '/img/',
            '/image/', 
            '/images/',
            '/pic/',
            '/picture/',
            '/gallery/',
            '/product/',
            '/item/',
            '/goods/',
            '/detail/',
            '/large/',
            '/big/',
            '/original/',
            '/full/',
            '/hd/',
            '/high/',
          ];

          // 检查文件名模式
          const hasLargeImagePattern = largeImagePatterns.some(pattern => 
            pattern.test(filename) || pattern.test(urlLower)
          );

          // 检查路径特征
          const hasLargeImagePath = largeImagePaths.some(path => 
            urlLower.includes(path)
          );

          // 文件大小启发（基于URL参数或文件名中的数字）
          const sizeHints = filename.match(/(\d{3,4})[x_-]?(\d{3,4})?/g);
          const hasSizeHints = sizeHints && sizeHints.some(hint => {
            const numbers = hint.match(/\d{3,4}/g);
            return numbers && numbers.some(num => parseInt(num) >= 800);
          });

          // 排除明显的小图标识
          const smallImagePatterns = [
            /_s\./,           // _s.jpg (small)
            /_small\./,       // _small.jpg
            /_thumb\./,       // _thumb.jpg
            /_thumbnail\./,   // _thumbnail.jpg
            /icon/,           // icon
            /logo/,           // logo  
            /avatar/,         // avatar
            /btn/,            // button
            /button/,         // button
            /nav/,            // navigation
            /_mini\./,        // _mini.jpg
            /_xs\./,          // _xs.jpg (extra small)
          ];

          const hasSmallImagePattern = smallImagePatterns.some(pattern =>
            pattern.test(filename) || pattern.test(urlLower)
          );

          const isLikelyLargeImage = !hasSmallImagePattern && (
            hasLargeImagePattern || 
            hasLargeImagePath || 
            hasSizeHints
          );

          if (isLikelyLargeImage) {
            shouldInclude = true;
            // 根据URL中的尺寸信息估算，否则使用默认值
            if (sizeHints) {
              const sizeMatch = sizeHints[0].match(/(\d{3,4})/g);
              if (sizeMatch && sizeMatch.length >= 1) {
                estimatedWidth = parseInt(sizeMatch[0]);
                estimatedHeight = sizeMatch.length >= 2 ? parseInt(sizeMatch[1]) : estimatedWidth;
              }
            } else {
              estimatedWidth = 1200; // 默认估算尺寸
              estimatedHeight = 1200;
            }
            console.log(`[图片提取] 图片 #${index}: 根据文件名特征判断为大图 (估算尺寸: ${estimatedWidth}x${estimatedHeight})`);
          } else {
            console.log(`[图片提取] 图片 #${index}: 文件名特征不符合大图要求`);
          }
        } else {
          // 普通图片或能获取尺寸的金店铺图片
          shouldInclude = this.width >= 1000 && this.height >= 1000;
        }

        if (shouldInclude) {
          console.log(
            `[图片提取] 图片 #${index}: ✅ 符合高分辨率要求 (${estimatedWidth}x${estimatedHeight})`
          );

          // 检查是否已存在具有相同URL的图片
          const isDuplicate = highResImages.some(
            img => img.url === bigImageUrl
          );

          if (!isDuplicate) {
            highResImages.push({
              url: bigImageUrl,
              width: estimatedWidth,
              height: estimatedHeight,
              isGoldShop: isGoldShopImage,
              isEstimated:
                isGoldShopImage && (this.width === 0 || this.height === 0),
            });
            largeImages++;
          } else {
            console.log(`[图片提取] 图片 #${index}: 已存在相同URL的图片，跳过`);
          }
        } else {
          console.log(
            `[图片提取] 图片 #${index}: ❌ 尺寸不足 (${this.width}x${this.height})`
          );
          smallImages++;
        }

        processedCount++;
        if (processedCount === imgElements.length) {
          logExtractSummary();
          resolve(highResImages);
        }
      };

      tempImg.onerror = function () {
        console.log(
          `[图片提取] 图片 #${index}: ❌ 加载失败: ${bigImageUrl.substring(0, 100)}...`
        );

        // 对于金店铺图片，即使加载失败也可能是有效的大图（跨域限制）
        if (isGoldShopImage) {
          console.log(
            `[图片提取] 图片 #${index}: 金店铺图片加载失败，可能是跨域限制，尝试启发式判断`
          );

          // 使用与上面相同的改进启发式判断逻辑
          const filename = bigImageUrl.split('/').pop().toLowerCase();
          const urlLower = bigImageUrl.toLowerCase();
          
          const largeImagePatterns = [
            /_l\./, /_large\./, /_big\./, /_main\./, /_detail\./, /_original\./,
            /_high\./, /_hd\./, /_full\./, /lp/, /banner/, /hero/, /slide/, /carousel/,
            /\d{3,4}x\d{3,4}/, /\d{4,}/
          ];

          const largeImagePaths = [
            '/img/', '/image/', '/images/', '/pic/', '/picture/', '/gallery/',
            '/product/', '/item/', '/goods/', '/detail/', '/large/', '/big/',
            '/original/', '/full/', '/hd/', '/high/'
          ];

          const smallImagePatterns = [
            /_s\./, /_small\./, /_thumb\./, /_thumbnail\./, /icon/, /logo/,
            /avatar/, /btn/, /button/, /nav/, /_mini\./, /_xs\./
          ];

          const hasLargeImagePattern = largeImagePatterns.some(pattern => 
            pattern.test(filename) || pattern.test(urlLower)
          );

          const hasLargeImagePath = largeImagePaths.some(path => 
            urlLower.includes(path)
          );

          const sizeHints = filename.match(/(\d{3,4})[x_-]?(\d{3,4})?/g);
          const hasSizeHints = sizeHints && sizeHints.some(hint => {
            const numbers = hint.match(/\d{3,4}/g);
            return numbers && numbers.some(num => parseInt(num) >= 800);
          });

          const hasSmallImagePattern = smallImagePatterns.some(pattern =>
            pattern.test(filename) || pattern.test(urlLower)
          );

          const isLikelyLargeImage = !hasSmallImagePattern && (
            hasLargeImagePattern || 
            hasLargeImagePath || 
            hasSizeHints
          );

          if (isLikelyLargeImage) {
            const isDuplicate = highResImages.some(
              img => img.url === bigImageUrl
            );
            if (!isDuplicate) {
              // 根据URL中的尺寸信息估算
              let estimatedWidth = 1200;
              let estimatedHeight = 1200;
              
              if (sizeHints) {
                const sizeMatch = sizeHints[0].match(/(\d{3,4})/g);
                if (sizeMatch && sizeMatch.length >= 1) {
                  estimatedWidth = parseInt(sizeMatch[0]);
                  estimatedHeight = sizeMatch.length >= 2 ? parseInt(sizeMatch[1]) : estimatedWidth;
                }
              }

              highResImages.push({
                url: bigImageUrl,
                width: estimatedWidth,
                height: estimatedHeight,
                isGoldShop: true,
                isEstimated: true,
                loadFailed: true,
              });
              largeImages++;
              console.log(
                `[图片提取] 图片 #${index}: 虽然加载失败，但根据特征判断为大图，已收录 (估算尺寸: ${estimatedWidth}x${estimatedHeight})`
              );
            }
          } else {
            console.log(
              `[图片提取] 图片 #${index}: 加载失败，且特征不符合大图要求，跳过`
            );
          }
        }

        processedCount++;
        errorImages++;
        if (processedCount === imgElements.length) {
          logExtractSummary();
          resolve(highResImages);
        }
      };

      tempImg.src = bigImageUrl;
    });

    // 设置超时，防止某些图片长时间不加载
    setTimeout(() => {
      if (processedCount < imgElements.length) {
        const remainingCount = imgElements.length - processedCount;
        console.log(
          `[图片提取] ⚠️ 超时! 还有 ${remainingCount} 张图片未处理完成，但已到达超时时间`
        );
        logExtractSummary();
        resolve(highResImages);
      }
    }, 8000); // 增加超时时间到8秒，适应慢速网络

    // 辅助函数：输出提取摘要
    function logExtractSummary() {
      console.log(`[图片提取] 摘要统计:`);
      console.log(`[图片提取] - 总图片数量: ${imgElements.length}`);
      console.log(
        `[图片提取] - 乐天CDN图片: ${rakutenImageCount - goldShopImageCount}`
      );
      console.log(`[图片提取] - 金店铺图片: ${goldShopImageCount}`);
      console.log(`[图片提取] - 非乐天图片: ${nonRakutenImageCount}`);
      console.log(`[图片提取] - 加载失败图片: ${errorImages}`);
      console.log(`[图片提取] - 小尺寸图片(<1000px): ${smallImages}`);
      console.log(`[图片提取] - 高分辨率图片(≥1000px): ${largeImages}`);
      console.log(`[图片提取] - 最终提取到的图片数量: ${highResImages.length}`);

      // 显示金店铺图片的特殊信息
      const goldShopImages = highResImages.filter(img => img.isGoldShop);
      if (goldShopImages.length > 0) {
        console.log(`[图片提取] - 金店铺图片详情:`);
        goldShopImages.forEach((img, idx) => {
          const status = img.loadFailed
            ? '(加载失败-启发式判断)'
            : img.isEstimated
              ? '(尺寸估算)'
              : '(尺寸确认)';
          console.log(
            `[图片提取]   ${idx + 1}. ${img.url.substring(0, 80)}... ${status}`
          );
        });
      }
    }
  });
}

// 从URL中提取店铺代码
function getShopCodeFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;

    // 支持 rakuten.co.jp 和 rakuten.ne.jp 域名
    if (
      !hostname.includes('rakuten.co.jp') &&
      !hostname.includes('rakuten.ne.jp')
    ) {
      return null;
    }

    let shopCode = null;

    // 处理 https://www.rakuten.ne.jp/gold/[店铺ID]/ 格式
    if (hostname.includes('rakuten.ne.jp') && pathname.startsWith('/gold/')) {
      const match = pathname.match(/^\/gold\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        shopCode = match[1];
      }
    }
    // 处理 https://www.rakuten.co.jp/[店铺ID]/ 格式
    else if (hostname.includes('rakuten.co.jp')) {
      const pathParts = pathname.split('/').filter(p => p);
      if (pathParts.length > 0) {
        // 排除一些系统路径
        if (
          ![
            'gold',
            'info',
            'rms',
            'event',
            'category',
            'sitemap',
            'news',
            'common',
            'test',
          ].includes(pathParts[0])
        ) {
          shopCode = pathParts[0]; // 第一部分通常是店铺代码
        }
      }
    }

    return shopCode;
  } catch (e) {
    console.error('解析URL失败:', e);
  }
  return null;
}

// 监听来自popup或background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(`[内容脚本] 收到消息: ${JSON.stringify(request)}`);

  if (request.action === 'getShopCodeFromPage') {
    const shopCode = getShopCodeFromUrl(window.location.href);
    if (shopCode) {
      console.log(`[内容脚本] 从页面URL提取到shopCode: ${shopCode}`);
      sendResponse({ success: true, shopCode: shopCode });
    } else {
      console.log(`[内容脚本] 从页面URL无法提取shopCode`);
      sendResponse({ success: false, error: '无法从当前页面URL获取店铺代码' });
    }
    return true; // 异步响应
  }

  if (request.action === 'extractHighResImages') {
    console.log('[内容脚本] 收到提取高分辨率图片的请求');
    extractHighResImages()
      .then(images => {
        console.log(
          `[内容脚本] 提取完成，找到 ${images.length} 张高分辨率图片`
        );
        sendResponse({
          success: true,
          images: images,
          productUrl: window.location.href,
          productTitle: document.title,
        });
      })
      .catch(error => {
        console.error('[内容脚本] 提取图片时发生错误:', error);
        sendResponse({
          success: false,
          error: error.message || '提取图片时出错',
        });
      });
    return true; // 异步响应
  }

  // 🚀 新增：快速提取已加载图片的请求处理
  if (request.action === 'extractLoadedImages') {
    console.log('[内容脚本] 🚀 收到快速提取已加载图片的请求');
    extractImagesFromLoadedContent()
      .then(images => {
        console.log(
          `[内容脚本] 🎉 快速提取完成，找到 ${images.length} 张已加载图片`
        );
        sendResponse({
          success: true,
          images: images,
          mode: 'loaded_content',
          productUrl: window.location.href,
          productTitle: document.title,
        });
      })
      .catch(error => {
        console.error('[内容脚本] 快速提取已加载图片时出错:', error);
        sendResponse({
          success: false,
          error: error.message || '快速提取图片时出错',
        });
      });
    return true; // 异步响应
  }
});

// 如果当前页面是商品详情页，自动提取图片
if (window.location.href.includes('item.rakuten.co.jp')) {
  console.log(
    '[内容脚本] 检测到乐天商品详情页，将在页面加载完成后提取高分辨率图片'
  );
  // 延迟执行以确保页面完全加载
  setTimeout(() => {
    console.log('[内容脚本] 页面加载完成，开始智能图片提取...');

    // 🚀 优化：先尝试快速模式，如果失败再用传统模式
    extractImagesFromLoadedContent()
      .then(loadedImages => {
        if (loadedImages.length > 0) {
          console.log(
            `[内容脚本] 🎉 快速模式成功！找到${loadedImages.length}张已加载图片，正在发送到后台...`
          );
          chrome.runtime.sendMessage(
            {
              action: 'detectedHighResImages',
              images: loadedImages,
              productUrl: window.location.href,
              productTitle: document.title,
              extractionMode: 'fast_loaded', // 🔧 标记为快速模式
            },
            response => {
              if (chrome.runtime.lastError) {
                console.error(
                  '[内容脚本] 发送图片到后台时出错:',
                  chrome.runtime.lastError
                );
              } else if (response && response.success) {
                console.log('[内容脚本] 🎉 快速模式图片已成功发送到后台并保存');
                handleAutoClose();
              } else {
                console.log(
                  '[内容脚本] 发送图片到后台后收到错误响应:',
                  response?.error || '未知错误'
                );
              }
            }
          );
        } else {
          console.log('[内容脚本] ⚠️ 快速模式未找到图片，回退到传统模式...');
          // 🔧 回退到传统模式
          fallbackToTraditionalMode();
        }
      })
      .catch(error => {
        console.error('[内容脚本] 快速模式提取图片时出错，回退到传统模式:', error);
        // 🔧 回退到传统模式
        fallbackToTraditionalMode();
      });

  // 🔧 传统模式回退函数
  function fallbackToTraditionalMode() {
    console.log('[内容脚本] 🔄 开始传统模式图片提取...');
    extractHighResImages()
      .then(images => {
        if (images.length > 0) {
          console.log(
            `[内容脚本] 传统模式找到${images.length}张高分辨率图片，正在发送到后台...`
          );
          chrome.runtime.sendMessage(
            {
              action: 'detectedHighResImages',
              images: images,
              productUrl: window.location.href,
              productTitle: document.title,
              extractionMode: 'traditional', // 🔧 标记为传统模式
            },
            response => {
              if (chrome.runtime.lastError) {
                console.error(
                  '[内容脚本] 传统模式发送图片到后台时出错:',
                  chrome.runtime.lastError
                );
              } else if (response && response.success) {
                console.log('[内容脚本] 传统模式图片已成功发送到后台并保存');
                handleAutoClose();
              } else {
                console.log(
                  '[内容脚本] 传统模式发送图片到后台后收到错误响应:',
                  response?.error || '未知错误'
                );
              }
            }
          );
        } else {
          console.log('[内容脚本] 传统模式也未找到高分辨率图片');
          // 即使没找到图片，在自动批量模式下也通知已处理
          chrome.runtime.sendMessage({
            action: 'detectedHighResImages',
            images: [],
            productUrl: window.location.href,
            productTitle: document.title,
            extractionMode: 'traditional_no_images',
          });
        }
      })
      .catch(error => {
        console.error('[内容脚本] 传统模式提取高分辨率图片时出错:', error);
        // 发送空结果通知处理完成
        chrome.runtime.sendMessage({
          action: 'detectedHighResImages',
          images: [],
          productUrl: window.location.href,
          productTitle: document.title,
          extractionMode: 'traditional_error',
          error: error.message,
        });
      });
  }

  // 🔧 处理自动关闭逻辑
  function handleAutoClose() {
    // 自动批量模式时，可以通知父窗口关闭此标签页
    if (
      window.opener &&
      new URLSearchParams(window.location.search).get('autoBatch') === 'true'
    ) {
      console.log('[内容脚本] 自动批量模式，提取完成，准备关闭');
      try {
        window.close();
      } catch (e) {
        console.log('[内容脚本] 无法自动关闭窗口');
      }
    }
  }

  }, 2000); // 🔧 减少延迟时间，因为快速模式不需要等待太久
} else {
  console.log(`[内容脚本] 当前页面不是商品详情页: ${window.location.href}`);
}
