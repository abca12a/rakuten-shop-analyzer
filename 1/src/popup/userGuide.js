/**
 * 用户引导模块
 * 提供新手引导和使用帮助功能
 */

// 引导步骤配置
const GUIDE_STEPS = [
  {
    id: 'welcome',
    title: '欢迎使用乐天店铺数据分析器！',
    content: `
            <div class="guide-welcome">
                <p>这个弹窗保留了最常用的 4 个动作：</p>
                <ul>
                    <li>抓取店铺商品数据</li>
                    <li>批量抓取高分辨率图片</li>
                    <li>导出商品 CSV 或图片 URL CSV</li>
                    <li>打开连接说明、诊断和恢复界面</li>
                </ul>
                <p><strong>当前版本已经固定连接服务器，无需再填写乐天 API 凭证。</strong></p>
            </div>
        `,
    position: 'center',
    showSkip: true,
  },
  {
    id: 'api-setup',
    title: '第一步：确认服务器连接',
    content: `
            <div class="guide-step">
                <p>🌐 在开始使用前，先确认扩展连接的是固定服务器：</p>
                <ol>
                    <li>点击“打开设置”</li>
                    <li>确认接口地址是 <code>https://api.845817074.xyz</code></li>
                    <li>确认设置页显示“固定服务器模式已启用”</li>
                    <li>返回弹窗继续操作</li>
                </ol>
                <p><small>💡 Rakuten 的真实凭证应保存在服务器环境变量里，不放在扩展中。</small></p>
            </div>
        `,
    target: '#openOptionsBtn',
    position: 'bottom',
  },
  {
    id: 'shop-input',
    title: '第二步：输入店铺代码',
    content: `
            <div class="guide-step">
                <p>📝 输入要分析的店铺代码：</p>
                <ul>
                    <li>可以直接输入店铺代码（如：example-shop）</li>
                    <li>也可以粘贴完整的店铺URL</li>
                    <li>也可以点击“读取当前页”自动填充</li>
                </ul>
                <p><strong>示例：</strong> brighte-onlineshop</p>
            </div>
        `,
    target: '#shopCode',
    position: 'bottom',
  },
  {
    id: 'basic-scrape',
    title: '第三步：开始数据抓取',
    content: `
            <div class="guide-step">
                <p>🚀 点击"开始抓取"获取商品数据：</p>
                <ul>
                    <li>建议保持“获取商品排名”和“安全模式”开启</li>
                    <li>抓取过程可能需要几分钟</li>
                    <li>关闭弹窗后任务仍会在后台继续</li>
                </ul>
                <p><small>💡 首次使用建议先测试小店铺。</small></p>
            </div>
        `,
    target: '#startScrapeBtn',
    position: 'top',
  },
  {
    id: 'image-modes',
    title: '第四步：图片抓取模式',
    content: `
            <div class="guide-step">
                <p>🖼️ 选择合适的图片抓取模式：</p>
                <ul>
                    <li><strong>下载图片文件</strong>：直接下载到本地</li>
                    <li><strong>仅导出图片 URL CSV</strong>：生成链接表</li>
                </ul>
                <p><small>💡 新手更适合先用“仅导出图片 URL CSV”。</small></p>
            </div>
        `,
    target: '#imageFetchModeSelect',
    position: 'bottom',
  },
  {
    id: 'export-data',
    title: '第五步：导出数据',
    content: `
            <div class="guide-step">
                <p>📁 数据抓取完成后，可以导出：</p>
                <ul>
                    <li><strong>导出商品 CSV</strong>：适合 Excel 分析</li>
                    <li><strong>导出图片 URL CSV</strong>：适合批量下载或二次处理</li>
                </ul>
                <p><small>💡 大多数场景先导出商品 CSV 即可。</small></p>
            </div>
        `,
    target: '#exportCsvBtn',
    position: 'top',
  },
  {
    id: 'quick-test',
    title: '遇到问题？',
    content: `
            <div class="guide-step">
                <p>🔧 如果遇到问题，可以：</p>
                <ul>
                    <li>点击“系统诊断”检查服务器和代理链路</li>
                    <li>点击“恢复界面”重置卡住的按钮状态</li>
                    <li>查看操作日志了解详细信息</li>
                </ul>
                <p><strong>引导完成，现在可以开始使用了。</strong></p>
            </div>
        `,
    target: '#helpPanel',
    position: 'top',
  },
];

// 引导状态管理
class UserGuide {
  constructor() {
    this.currentStep = 0;
    this.isActive = false;
    this.overlay = null;
    this.tooltip = null;
  }

  // 检查是否是首次使用
  async isFirstTime() {
    const result = await chrome.storage.local.get('userGuideCompleted');
    return !result.userGuideCompleted;
  }

  // 标记引导完成
  async markCompleted() {
    await chrome.storage.local.set({ userGuideCompleted: true });
  }

  // 开始引导
  async start() {
    console.log('[引导] 开始引导流程');

    if (this.isActive) {
      console.log('[引导] 引导已在进行中，忽略重复启动');
      return;
    }

    try {
      this.isActive = true;
      this.currentStep = 0;

      console.log('[引导] 创建遮罩层');
      this.createOverlay();

      // 确保遮罩层已添加到DOM
      if (!this.overlay || !document.body.contains(this.overlay)) {
        throw new Error('遮罩层创建失败');
      }

      console.log('[引导] 显示第一步');
      this.showStep(0);
    } catch (error) {
      console.error('[引导] 启动引导时出错:', error);
      this.isActive = false;
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
    }
  }

  // 创建遮罩层
  createOverlay() {
    // 移除可能存在的旧遮罩层
    if (this.overlay) {
      this.overlay.remove();
    }

    this.overlay = document.createElement('div');
    this.overlay.className = 'user-guide-overlay';
    this.overlay.innerHTML = `
            <style>
                .user-guide-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 10000;
                    pointer-events: none;
                }
                .user-guide-tooltip {
                    position: absolute;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                    padding: 20px;
                    max-width: 320px;
                    z-index: 10001;
                    pointer-events: auto;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .user-guide-tooltip h3 {
                    margin: 0 0 15px 0;
                    color: #333;
                    font-size: 16px;
                    font-weight: 600;
                }
                .user-guide-tooltip .guide-content {
                    color: #555;
                    line-height: 1.5;
                    margin-bottom: 20px;
                }
                .user-guide-tooltip .guide-content ul, 
                .user-guide-tooltip .guide-content ol {
                    margin: 10px 0;
                    padding-left: 20px;
                }
                .user-guide-tooltip .guide-content li {
                    margin: 5px 0;
                }
                .user-guide-tooltip .guide-buttons {
                    display: flex;
                    gap: 10px;
                    justify-content: flex-end;
                }
                .user-guide-tooltip button {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                }
                .user-guide-tooltip .btn-primary {
                    background: #007bff;
                    color: white;
                }
                .user-guide-tooltip .btn-secondary {
                    background: #6c757d;
                    color: white;
                }
                .user-guide-tooltip .btn-skip {
                    background: #dc3545;
                    color: white;
                }
                .user-guide-highlight {
                    position: relative;
                    z-index: 10002;
                    box-shadow: 0 0 0 4px rgba(0, 123, 255, 0.5);
                    border-radius: 4px;
                }
            </style>
        `;

    // 添加到DOM
    document.body.appendChild(this.overlay);

    // 验证是否成功添加
    if (!document.body.contains(this.overlay)) {
      console.error('[引导] 遮罩层添加到DOM失败');
      throw new Error('无法创建引导遮罩层');
    }

    console.log('[引导] 遮罩层创建成功');
  }

  // 显示指定步骤
  showStep(stepIndex) {
    console.log(`[引导] 显示步骤 ${stepIndex}/${GUIDE_STEPS.length - 1}`);

    if (stepIndex < 0) {
      console.warn('[引导] 步骤索引小于0，重置为0');
      stepIndex = 0;
    }

    if (stepIndex >= GUIDE_STEPS.length) {
      console.log('[引导] 已完成所有步骤，执行完成');
      this.complete();
      return;
    }

    const step = GUIDE_STEPS[stepIndex];
    if (!step) {
      console.error(`[引导] 步骤 ${stepIndex} 不存在`);
      return;
    }

    this.currentStep = stepIndex;
    console.log(`[引导] 当前步骤: ${step.title}`);

    // 移除之前的高亮
    document.querySelectorAll('.user-guide-highlight').forEach(el => {
      el.classList.remove('user-guide-highlight');
    });

    // 创建提示框
    try {
      this.createTooltip(step);
    } catch (error) {
      console.error('[引导] 创建提示框失败:', error);
      return;
    }

    // 高亮目标元素
    if (step.target) {
      const target = document.querySelector(step.target);
      if (target) {
        target.classList.add('user-guide-highlight');
        // 延迟滚动，确保提示框已经定位
        setTimeout(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
        console.log(`[引导] 高亮目标元素: ${step.target}`);
      } else {
        console.warn(`[引导] 目标元素不存在: ${step.target}`);
      }
    }
  }

  // 创建提示框
  createTooltip(step) {
    if (this.tooltip) {
      this.tooltip.remove();
    }

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'user-guide-tooltip';

    const isLast = this.currentStep === GUIDE_STEPS.length - 1;
    const showSkip = step.showSkip && this.currentStep === 0;

    this.tooltip.innerHTML = `
            <h3>${step.title}</h3>
            <div class="guide-content">${step.content}</div>
            <div class="guide-buttons">
                ${showSkip ? '<button class="btn-skip" data-action="skip">跳过引导</button>' : ''}
                ${this.currentStep > 0 ? '<button class="btn-secondary" data-action="prev">上一步</button>' : ''}
                <button class="btn-primary" data-action="${isLast ? 'complete' : 'next'}">
                    ${isLast ? '完成' : '下一步'}
                </button>
            </div>
        `;

    // 添加事件监听器
    this.tooltip.querySelectorAll('button').forEach((button, index) => {
      const action = button.getAttribute('data-action');
      console.log(`[引导] 绑定按钮事件: ${action} (按钮 ${index})`);

      button.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();

        const clickedAction = e.target.getAttribute('data-action');
        console.log(`[引导] 按钮点击: ${clickedAction}`);

        try {
          switch (clickedAction) {
            case 'skip':
              console.log('[引导] 执行跳过');
              this.skip();
              break;
            case 'prev':
              console.log('[引导] 执行上一步');
              this.prev();
              break;
            case 'next':
              console.log('[引导] 执行下一步');
              this.next();
              break;
            case 'complete':
              console.log('[引导] 执行完成');
              this.complete();
              break;
            default:
              console.warn(`[引导] 未知操作: ${clickedAction}`);
          }
        } catch (error) {
          console.error(`[引导] 执行操作 ${clickedAction} 时出错:`, error);
        }
      });
    });

    this.overlay.appendChild(this.tooltip);

    // 延迟定位，确保tooltip已经渲染
    // 使用requestAnimationFrame确保DOM更新完成
    requestAnimationFrame(() => {
      setTimeout(() => {
        this.positionTooltip(step);
      }, 50); // 增加延迟时间确保渲染完成
    });
  }

  // 定位提示框
  positionTooltip(step) {
    if (!this.tooltip) {
      console.warn('[引导] tooltip不存在，无法定位');
      return;
    }

    // 重置定位样式
    this.tooltip.style.top = '';
    this.tooltip.style.left = '';
    this.tooltip.style.transform = '';
    this.tooltip.style.position = 'absolute';

    if (step.position === 'center') {
      this.tooltip.style.top = '50%';
      this.tooltip.style.left = '50%';
      this.tooltip.style.transform = 'translate(-50%, -50%)';
      console.log('[引导] 居中定位完成');
      return;
    }

    if (step.target) {
      const target = document.querySelector(step.target);
      if (!target) {
        console.warn(`[引导] 目标元素不存在: ${step.target}，使用居中定位`);
        this.tooltip.style.top = '50%';
        this.tooltip.style.left = '50%';
        this.tooltip.style.transform = 'translate(-50%, -50%)';
        return;
      }

      const rect = target.getBoundingClientRect();
      const tooltipRect = this.tooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      console.log(`[引导] 目标元素位置:`, rect);
      console.log(`[引导] tooltip尺寸:`, tooltipRect);

      let top, left;

      switch (step.position) {
        case 'top':
          top = rect.top - tooltipRect.height - 10;
          left = rect.left + rect.width / 2 - tooltipRect.width / 2;

          // 边界检查
          if (top < 10) {
            console.log('[引导] 顶部空间不足，改为底部显示');
            top = rect.bottom + 10;
          }
          break;

        case 'bottom':
          top = rect.bottom + 10;
          left = rect.left + rect.width / 2 - tooltipRect.width / 2;

          // 边界检查
          if (top + tooltipRect.height > viewportHeight - 10) {
            console.log('[引导] 底部空间不足，改为顶部显示');
            top = rect.top - tooltipRect.height - 10;
          }
          break;

        case 'left':
          top = rect.top + rect.height / 2 - tooltipRect.height / 2;
          left = rect.left - tooltipRect.width - 10;

          // 边界检查
          if (left < 10) {
            console.log('[引导] 左侧空间不足，改为右侧显示');
            left = rect.right + 10;
          }
          break;

        case 'right':
          top = rect.top + rect.height / 2 - tooltipRect.height / 2;
          left = rect.right + 10;

          // 边界检查
          if (left + tooltipRect.width > viewportWidth - 10) {
            console.log('[引导] 右侧空间不足，改为左侧显示');
            left = rect.left - tooltipRect.width - 10;
          }
          break;

        default:
          console.warn(`[引导] 未知的定位方式: ${step.position}，使用居中定位`);
          this.tooltip.style.top = '50%';
          this.tooltip.style.left = '50%';
          this.tooltip.style.transform = 'translate(-50%, -50%)';
          return;
      }

      // 最终边界检查和调整
      left = Math.max(
        10,
        Math.min(left, viewportWidth - tooltipRect.width - 10)
      );
      top = Math.max(
        10,
        Math.min(top, viewportHeight - tooltipRect.height - 10)
      );

      this.tooltip.style.top = top + 'px';
      this.tooltip.style.left = left + 'px';

      console.log(`[引导] 最终定位: top=${top}, left=${left}`);
    } else {
      // 没有目标元素，居中显示
      this.tooltip.style.top = '50%';
      this.tooltip.style.left = '50%';
      this.tooltip.style.transform = 'translate(-50%, -50%)';
      console.log('[引导] 无目标元素，使用居中定位');
    }
  }

  // 下一步
  next() {
    console.log(
      `[引导] 下一步: 当前步骤 ${this.currentStep}, 总步骤 ${GUIDE_STEPS.length}`
    );
    if (this.currentStep < GUIDE_STEPS.length - 1) {
      this.showStep(this.currentStep + 1);
    } else {
      console.log('[引导] 已是最后一步，执行完成');
      this.complete();
    }
  }

  // 上一步
  prev() {
    console.log(`[引导] 上一步: 当前步骤 ${this.currentStep}`);
    if (this.currentStep > 0) {
      this.showStep(this.currentStep - 1);
    } else {
      console.log('[引导] 已是第一步，无法后退');
    }
  }

  // 跳过引导
  skip() {
    this.complete();
  }

  // 完成引导
  async complete() {
    this.isActive = false;

    // 移除高亮
    document.querySelectorAll('.user-guide-highlight').forEach(el => {
      el.classList.remove('user-guide-highlight');
    });

    // 移除遮罩层
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }

    // 标记完成
    await this.markCompleted();

    // 显示完成提示
    this.showCompletionMessage();
  }

  // 显示完成提示
  showCompletionMessage() {
    const statusArea = document.getElementById('statusArea');
    if (statusArea) {
      statusArea.textContent = '引导完成，现在可以开始使用。';
      statusArea.className = 'message-base message-success';
    }
  }

  // 重置引导系统（用于调试和错误恢复）
  reset() {
    console.log('[引导] 重置引导系统');

    this.isActive = false;
    this.currentStep = 0;

    // 移除高亮
    document.querySelectorAll('.user-guide-highlight').forEach(el => {
      el.classList.remove('user-guide-highlight');
    });

    // 移除遮罩层
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }

    // 移除tooltip
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }

    console.log('[引导] 重置完成');
  }
}

// 创建全局实例
const userGuide = new UserGuide();

// 导出函数
export { userGuide, UserGuide };
