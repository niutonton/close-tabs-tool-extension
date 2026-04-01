let allTabs = []; // To cache all open tabs
let tooltipTimeout;

function showTooltip(text, event) {
    const tooltip = document.getElementById('custom-tooltip');
    tooltip.textContent = text;
    tooltip.style.display = 'block';
    tooltip.style.opacity = '0'; // Keep it invisible for measurement

    const tooltipRect = tooltip.getBoundingClientRect();
    const bodyRect = document.body.getBoundingClientRect();

    let left = event.clientX + 15;
    let top = event.clientY + 15;

    if (left + tooltipRect.width > bodyRect.width - 5) {
        left = event.clientX - tooltipRect.width - 15;
    }

    if (top + tooltipRect.height > bodyRect.height - 5) {
        top = event.clientY - tooltipRect.height - 15;
    }

    if (left < 5) left = 5;
    if (top < 5) top = 5;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    setTimeout(() => {
        tooltip.style.opacity = '1';
    }, 10);
}

function hideTooltip() {
    const tooltip = document.getElementById('custom-tooltip');
    tooltip.style.opacity = '0';
    setTimeout(() => {
        tooltip.style.display = 'none';
    }, 150);
}

let isInitializing = false;
let scrollPositions = {};
let initDebounceTimeout;
let currentPopupWinId; // This will store the window ID where the popup was opened

// A debounced version of init() to prevent rapid-fire updates
function scheduleInit() {
    clearTimeout(initDebounceTimeout);
    initDebounceTimeout = setTimeout(init, 150);
}

// Renders tabs grouped by window
async function renderTabs(groupedTabs, totalTabCount, names, urlCounts) {
    const tabsContainer = document.getElementById('tabs-container');

    // Save scroll positions
    document.querySelectorAll('.window-container').forEach(container => {
        const windowId = container.dataset.windowId;
        const tabList = container.querySelector('.tab-list');
        if (windowId && tabList) {
            scrollPositions[windowId] = tabList.scrollTop;
        }
    });

    tabsContainer.innerHTML = '';
    document.getElementById('tab-count').textContent = `总共 ${totalTabCount} 个标签页`;

    // Use the stored popup window ID for sorting
    const windowIds = Object.keys(groupedTabs).sort((a, b) => {
        if (parseInt(a) === currentPopupWinId) return -1; // Popup's window first
        if (parseInt(b) === currentPopupWinId) return 1;
        return parseInt(a) - parseInt(b);
    });

    for (const windowId of windowIds) {
        const tabs = groupedTabs[windowId];
        tabs.sort((a, b) => a.index - b.index);

        const windowContainer = document.createElement('div');
        windowContainer.className = 'window-container';
        windowContainer.dataset.windowId = windowId;

        const windowHeader = document.createElement('div');
        windowHeader.className = 'window-header';
        if (parseInt(windowId) === currentPopupWinId) {
            windowHeader.classList.add('current-window');
        }

        const windowTitle = document.createElement('div');
        windowTitle.className = 'window-title';
        windowTitle.textContent = names[windowId] || `窗口 ${windowId}`;
        windowTitle.setAttribute('title', '点击可重命名');

        windowTitle.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'window-title-input';
            input.value = windowTitle.textContent;

            windowTitle.replaceWith(input);
            input.focus();
            input.select();

            const saveName = async () => {
                const newName = input.value.trim();
                const { windowNames } = await chrome.storage.local.get('windowNames');
                const currentNames = windowNames || {};

                if (newName && newName !== `窗口 ${windowId}`) {
                    currentNames[windowId] = newName;
                } else {
                    delete currentNames[windowId];
                }

                await chrome.storage.local.set({ windowNames: currentNames });
                windowTitle.textContent = newName || `窗口 ${windowId}`;
                input.replaceWith(windowTitle);
            };

            input.addEventListener('blur', saveName);
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') saveName();
                if (e.key === 'Escape') input.replaceWith(windowTitle);
            });
        });

        windowHeader.appendChild(windowTitle);

        const tabCountInWindow = document.createElement('span');
        tabCountInWindow.className = 'tab-count-in-window';
        tabCountInWindow.textContent = `${tabs.length} 个标签页`;
        windowHeader.appendChild(tabCountInWindow);

        const closeWindowBtn = document.createElement('button');
        closeWindowBtn.className = 'close-window-btn';
        closeWindowBtn.innerHTML = '&times;';
        closeWindowBtn.addEventListener('mouseover', (e) => showTooltip('关闭窗口', e));
        closeWindowBtn.addEventListener('mouseout', hideTooltip);
        closeWindowBtn.onclick = async (e) => {
            e.stopPropagation();
            try {
                await chrome.windows.remove(parseInt(windowId, 10));
            } catch (error) {
                console.error(`Failed to close window ${windowId}:`, error.message);
            }
        };
        windowHeader.appendChild(closeWindowBtn);

        windowContainer.appendChild(windowHeader);

        const tabList = document.createElement('div');
        tabList.className = 'tab-list';

        // Add scroll listener to hide floating actions on scroll
        tabList.addEventListener('scroll', () => {
             const floatingActions = document.getElementById('floating-actions');
             if (floatingActions) floatingActions.style.display = 'none';
        });

        for (const tab of tabs) {
            const tabElement = createTabElement(tab, windowId, urlCounts);
            tabList.appendChild(tabElement);
        }
        windowContainer.appendChild(tabList);
        tabsContainer.appendChild(windowContainer);

        // Restore scroll position
        if (scrollPositions[windowId]) {
            setTimeout(() => {
                tabList.scrollTop = scrollPositions[windowId];
            }, 0);
        }
    }
}

function createTabElement(tab, windowId, urlCounts) {
    const tabItem = document.createElement('div');
    tabItem.className = 'tab-item';
    tabItem.dataset.tabId = tab.id;
    tabItem.draggable = true;

    // --- Drag and Drop Logic ---
    tabItem.addEventListener('dragstart', (e) => {
        const selectedItems = document.querySelectorAll('.tab-item.selected');
        let dragIds;
        let isBatchDrag = false;

        if (selectedItems.length > 0 && tabItem.classList.contains('selected')) {
            isBatchDrag = true;
            dragIds = Array.from(selectedItems).map(item => item.dataset.tabId);
        } else {
            document.querySelectorAll('.tab-item.selected').forEach(item => {
                item.classList.remove('selected');
            });
            dragIds = [tab.id];
        }
        
        e.dataTransfer.setData('text/plain', dragIds.join(','));
        e.dataTransfer.effectAllowed = 'move';

        if (isBatchDrag) {
            const dragPreview = document.createElement('div');
            dragPreview.className = 'drag-preview';
            dragPreview.textContent = `移动 ${dragIds.length} 个标签页`;
            
            const counter = document.createElement('span');
            counter.className = 'drag-preview-counter';
            counter.textContent = `+${dragIds.length}`;
            dragPreview.appendChild(counter);

            document.body.appendChild(dragPreview);
            e.dataTransfer.setDragImage(dragPreview, -10, -10); // Offset the image slightly

            // Clean up the preview element after the drag operation
            setTimeout(() => {
                document.body.removeChild(dragPreview);
            }, 0);
        }

        setTimeout(() => tabItem.classList.add('dragging'), 0);
    });

    tabItem.addEventListener('dragend', () => {
        tabItem.classList.remove('dragging');
        document.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over-forbidden').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-forbidden');
        });
    });

    tabItem.addEventListener('dragover', (e) => {
        e.preventDefault();
        const sourceIds = e.dataTransfer.getData('text/plain').split(',').map(id => parseInt(id, 10));
        const sourceTab = allTabs.find(t => t.id === sourceIds[0]);

        if (sourceTab && sourceTab.pinned !== tab.pinned) {
            tabItem.classList.add('drag-over-forbidden');
            return;
        }

        const rect = tabItem.getBoundingClientRect();
        const isNearTop = e.clientY < rect.top + rect.height / 2;
        if (isNearTop) {
            tabItem.classList.add('drag-over-top');
            tabItem.classList.remove('drag-over-bottom');
        } else {
            tabItem.classList.add('drag-over-bottom');
            tabItem.classList.remove('drag-over-top');
        }
    });

    tabItem.addEventListener('dragleave', (e) => {
        tabItem.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-forbidden');
    });

    tabItem.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        tabItem.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-forbidden');

        const sourceTabIds = e.dataTransfer.getData('text/plain').split(',').map(id => parseInt(id, 10));
        const sourceTab = allTabs.find(t => t.id === sourceTabIds[0]);

        if (!sourceTab || sourceTab.pinned !== tab.pinned) {
            return;
        }

        if (sourceTabIds.includes(tab.id)) return; // Avoid dropping a group onto itself

        const rect = tabItem.getBoundingClientRect();
        const isNearTop = e.clientY < rect.top + rect.height / 2;
        let newIndex = tab.index;

        if (sourceTab.windowId === tab.windowId && sourceTab.index < tab.index) {
            newIndex -= sourceTabIds.length;
        }
        
        if (!isNearTop) {
            newIndex++;
        }

        try {
            await chrome.tabs.move(sourceTabIds, { windowId: parseInt(windowId, 10), index: newIndex });
            scheduleInit();
        } catch (error) {
            console.error("Error moving tabs:", error);
        }
    });

    if (tab.pinned) {
        tabItem.classList.add('pinned');
    }

    tabItem.onclick = () => {
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
    };

    const favicon = document.createElement('img');
    favicon.src = tab.favIconUrl || 'icon128.png';
    favicon.className = 'favicon';
    favicon.onerror = () => { favicon.src = 'icon128.png'; };

    const title = document.createElement('span');
    title.textContent = tab.title;
    title.className = 'title';

    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-btn';
    pinBtn.innerHTML = '📌'; // Use a pin emoji as the icon
    pinBtn.addEventListener('mouseover', (e) => showTooltip(tab.pinned ? '取消固定' : '固定标签页', e));
    pinBtn.addEventListener('mouseout', hideTooltip);
    pinBtn.onclick = async (e) => {
        e.stopPropagation();
        await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
        scheduleInit();
    };

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('mouseover', (e) => showTooltip('关闭标签页', e));
    closeBtn.addEventListener('mouseout', hideTooltip);
    closeBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
            await chrome.tabs.remove(tab.id);
        } catch (error) {
            console.log(`Failed to close tab ${tab.id}:`, error.message);
            scheduleInit();
        }
    };

    tabItem.appendChild(favicon);
    tabItem.appendChild(title);

    if (tab.url && urlCounts[tab.url] > 1) {
        const duplicateBadge = document.createElement('span');
        duplicateBadge.className = 'duplicate-badge';
        duplicateBadge.textContent = urlCounts[tab.url];
        duplicateBadge.addEventListener('mouseover', (e) => showTooltip(`存在 ${urlCounts[tab.url]} 个相同标签页，点击关闭其余`, e));
        duplicateBadge.addEventListener('mouseout', hideTooltip);
        duplicateBadge.onclick = async (e) => {
            e.stopPropagation();
            const tabsToClose = await chrome.tabs.query({ url: tab.url });
            if (tabsToClose.length > 1) {
                const tabIdsToClose = tabsToClose.slice(1).map(t => t.id);
                await chrome.tabs.remove(tabIdsToClose);
            }
        };
        tabItem.appendChild(duplicateBadge);
    }

    tabItem.appendChild(pinBtn);
    tabItem.appendChild(closeBtn);

    return tabItem;
}

async function init() {
    if (isInitializing) return;
    isInitializing = true;
    try {
        const allTabsFromAPI = await chrome.tabs.query({});
        const { windowNames } = await chrome.storage.local.get('windowNames');
        const names = windowNames || {};

        allTabs = allTabsFromAPI;

        const searchBox = document.getElementById('search-box');
        const searchTerm = searchBox.value.toLowerCase();
        let tabsToRender = allTabs;

        if (searchTerm) {
            tabsToRender = allTabs.filter(tab => {
                const title = (tab.title || '').toLowerCase();
                const url = (tab.url || '').toLowerCase();
                return title.includes(searchTerm) || url.includes(searchTerm);
            });
        }

        const groupedTabs = tabsToRender.reduce((acc, tab) => {
            const windowId = tab.windowId;
            if (!acc[windowId]) {
                acc[windowId] = [];
            }
            acc[windowId].push(tab);
            return acc;
        }, {});

        const urlCounts = tabsToRender.reduce((acc, tab) => {
            if (tab.url) {
                acc[tab.url] = (acc[tab.url] || 0) + 1;
            }
            return acc;
        }, {});

        await renderTabs(groupedTabs, tabsToRender.length, names, urlCounts);
    } catch (error) {
        console.error("Error during init:", error);
    } finally {
        isInitializing = false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const currentWindow = await chrome.windows.getCurrent();
    currentPopupWinId = currentWindow.id;

    const searchBox = document.getElementById('search-box');
    const closeAllBtn = document.getElementById('close-all-btn');
    const addWindowBtn = document.getElementById('add-window-btn');
    
    // Floating Actions
    const floatingActions = document.getElementById('floating-actions');
    const floatCloseBtn = document.getElementById('float-close-btn');
    const floatDragHandle = document.getElementById('float-drag-handle');

    searchBox.addEventListener('input', () => {
        scheduleInit();
    });

    closeAllBtn.addEventListener('click', async () => {
        const tabsToClose = await chrome.tabs.query({ pinned: false });
        const tabIds = tabsToClose.map(tab => tab.id);
        if (tabIds.length > 0) {
            await chrome.tabs.remove(tabIds);
        }
    });
    closeAllBtn.addEventListener('mouseover', (e) => showTooltip('关闭所有未固定的标签页', e));
    closeAllBtn.addEventListener('mouseout', hideTooltip);

    addWindowBtn.addEventListener('click', () => {
        chrome.windows.create({ focused: true, type: 'normal' });
    });
    addWindowBtn.addEventListener('mouseover', (e) => showTooltip('新建窗口', e));
    addWindowBtn.addEventListener('mouseout', hideTooltip);

    // --- Marquee Selection Logic with Auto-Scroll ---
    const tabsContainer = document.getElementById('tabs-container');
    const selectionBox = document.getElementById('selection-box');
    let isSelecting = false;
    let startX = 0;
    let startY = 0;
    let initialScrollLeft = 0;
    let initialScrollTops = new Map();
    
    // Auto-scroll variables
    let autoScrollInterval = null;
    const baseScrollSpeed = 5; 
    
    function stopAutoScroll() {
        if (autoScrollInterval) {
            clearInterval(autoScrollInterval);
            autoScrollInterval = null;
        }
    }

    let lastMouseX = 0;
    let lastMouseY = 0;

    function handleAutoScroll() {
        if (!isSelecting) {
            stopAutoScroll();
            return;
        }

        const currentX = lastMouseX;
        const currentY = lastMouseY;

        // 获取整个可视区域的边界，或者是容器的边界
        // 这里以 body 或 tabsContainer 为准
        const containerRect = tabsContainer.getBoundingClientRect();
        
        // 水平滚动
        let scrollX = 0;
        if (currentX > containerRect.right) {
            const distance = currentX - containerRect.right;
            scrollX = baseScrollSpeed + distance * 0.2;
        } else if (currentX < containerRect.left) {
            const distance = containerRect.left - currentX;
            scrollX = -(baseScrollSpeed + distance * 0.2);
        }

        // 垂直滚动
        let scrollY = 0;
        let targetList = null;

        const allLists = document.querySelectorAll('.tab-list');
        let minDistX = Infinity;
        
        allLists.forEach(list => {
            const rect = list.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const dist = Math.abs(currentX - centerX);
            if (dist < minDistX) {
                minDistX = dist;
                targetList = list;
            }
        });

        if (targetList) {
            const listRect = targetList.getBoundingClientRect();
            if (currentY > listRect.bottom) {
                const distance = currentY - listRect.bottom;
                scrollY = baseScrollSpeed + distance * 0.2;
            } else if (currentY < listRect.top) {
                const distance = listRect.top - currentY;
                scrollY = -(baseScrollSpeed + distance * 0.2);
            }
        }

        if (scrollX !== 0 || scrollY !== 0) {
            if (!autoScrollInterval) {
                autoScrollInterval = setInterval(() => {
                    let scrolled = false;
                    if (scrollX !== 0) {
                        tabsContainer.scrollBy({ left: scrollX, behavior: 'auto' });
                        scrolled = true;
                    }
                    if (scrollY !== 0 && targetList) {
                        targetList.scrollBy({ top: scrollY, behavior: 'auto' });
                        scrolled = true;
                    }
                    // 滚动后，更新选择框的位置和选中状态
                    if (scrolled) {
                        updateSelection(lastMouseX, lastMouseY);
                    }
                }, 16);
            }
        } else {
            stopAutoScroll();
        }
    }

    function updateSelection(currentX, currentY) {
        lastMouseX = currentX;
        lastMouseY = currentY;
        
        let effectiveStartX = startX - (tabsContainer.scrollLeft - initialScrollLeft);
        
        // 为了让视觉上的蓝色框选框表现自然，我们让它吸附到鼠标当前所在的列表中
        let targetList = null;
        let minDistX = Infinity;
        document.querySelectorAll('.tab-list').forEach(list => {
            const rect = list.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const dist = Math.abs(currentX - centerX);
            if (dist < minDistX) {
                minDistX = dist;
                targetList = list;
            }
        });

        let visualEffectiveStartY = startY;
        if (targetList && initialScrollTops.has(targetList)) {
            visualEffectiveStartY = startY - (targetList.scrollTop - initialScrollTops.get(targetList));
        }

        const width = Math.abs(currentX - effectiveStartX);
        const height = Math.abs(currentY - visualEffectiveStartY);
        const left = Math.min(currentX, effectiveStartX);
        const top = Math.min(currentY, visualEffectiveStartY);

        selectionBox.style.width = `${width}px`;
        selectionBox.style.height = `${height}px`;
        selectionBox.style.left = `${left}px`;
        selectionBox.style.top = `${top}px`;

        // 现在针对每个独立的标签页计算真实的碰撞检测
        // 因为每个列表的滚动状态可能不同，我们必须让选中逻辑基于标签页所在列表的滚动偏移来单独计算
        const itemSelectionLeft = Math.min(currentX, effectiveStartX);
        const itemSelectionRight = Math.max(currentX, effectiveStartX);

        document.querySelectorAll('.tab-item').forEach(tabItem => {
            const list = tabItem.closest('.tab-list');
            const scrollDelta = list && initialScrollTops.has(list) ? list.scrollTop - initialScrollTops.get(list) : 0;
            
            // 这个标签页对应的逻辑起始Y坐标
            const itemEffectiveStartY = startY - scrollDelta;
            const itemSelectionTop = Math.min(currentY, itemEffectiveStartY);
            const itemSelectionBottom = Math.max(currentY, itemEffectiveStartY);
            
            const tabRect = tabItem.getBoundingClientRect();
            
            // 加上一些容差，防止边界因为小数问题判定失败
            if (itemSelectionLeft < tabRect.right - 5 &&
                itemSelectionRight > tabRect.left + 5 &&
                itemSelectionTop < tabRect.bottom - 5 &&
                itemSelectionBottom > tabRect.top + 5) {
                tabItem.classList.add('selected');
            } else {
                tabItem.classList.remove('selected');
            }
        });
    }

    tabsContainer.addEventListener('mousedown', (e) => {
        if (e.target === tabsContainer || e.target.classList.contains('window-container') || e.target.classList.contains('tab-list')) {
            document.querySelectorAll('.tab-item.selected').forEach(item => {
                item.classList.remove('selected');
            });
            floatingActions.style.display = 'none';

            isSelecting = true;
            startX = e.clientX;
            startY = e.clientY;
            
            // 记录初始的滚动位置
            initialScrollLeft = tabsContainer.scrollLeft;
            initialScrollTops.clear();
            document.querySelectorAll('.tab-list').forEach(list => {
                initialScrollTops.set(list, list.scrollTop);
            });

            selectionBox.style.left = `${startX}px`;
            selectionBox.style.top = `${startY}px`;
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
            selectionBox.style.display = 'block';
            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isSelecting) return;
        
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        
        updateSelection(lastMouseX, lastMouseY);
        handleAutoScroll();
    });

    document.addEventListener('mouseup', (e) => {
        if (isSelecting) {
            isSelecting = false;
            stopAutoScroll();
            selectionBox.style.display = 'none';

            const selectedItems = document.querySelectorAll('.tab-item.selected');
            if (selectedItems.length > 0) {
                // Calculate position for floating actions
                let minTop = Infinity;
                let minLeft = Infinity;
                let maxRight = -Infinity;

                selectedItems.forEach(item => {
                    const rect = item.getBoundingClientRect();
                    if (rect.top < minTop) minTop = rect.top;
                    if (rect.left < minLeft) minLeft = rect.left;
                    if (rect.right > maxRight) maxRight = rect.right;
                });

                // Position logic
                const centerX = minLeft + (maxRight - minLeft) / 2;
                let left = centerX - 70; 
                let top = minTop - 50; 

                // Boundary checks
                if (top < 10) top = minTop + 10; 
                if (left < 10) left = 10;
                if (left > 600) left = 600;

                floatingActions.style.left = `${left}px`;
                floatingActions.style.top = `${top}px`;
                floatingActions.style.display = 'flex';
            } else {
                floatingActions.style.display = 'none';
            }
        }
    });

    // Float Actions Logic
    floatCloseBtn.addEventListener('click', async () => {
        const selectedItems = document.querySelectorAll('.tab-item.selected');
        const tabIds = Array.from(selectedItems).map(i => parseInt(i.dataset.tabId));
        if (tabIds.length > 0) {
            await chrome.tabs.remove(tabIds);
            floatingActions.style.display = 'none';
        }
    });

    floatDragHandle.addEventListener('dragstart', (e) => {
        const selectedItems = document.querySelectorAll('.tab-item.selected');
        const dragIds = Array.from(selectedItems).map(item => item.dataset.tabId);
        
        e.dataTransfer.setData('text/plain', dragIds.join(','));
        e.dataTransfer.effectAllowed = 'move';

        const dragPreview = document.createElement('div');
        dragPreview.className = 'drag-preview';
        dragPreview.textContent = `移动 ${dragIds.length} 个标签页`;
        const counter = document.createElement('span');
        counter.className = 'drag-preview-counter';
        counter.textContent = `+${dragIds.length}`;
        dragPreview.appendChild(counter);

        document.body.appendChild(dragPreview);
        e.dataTransfer.setDragImage(dragPreview, -10, -10);

        setTimeout(() => document.body.removeChild(dragPreview), 0);
    });

    floatDragHandle.addEventListener('dragend', () => {
         document.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over-forbidden').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-forbidden');
        });
    });

    scheduleInit();
});

// Listen for window and tab changes to keep the UI in sync
chrome.windows.onCreated.addListener(scheduleInit);
chrome.tabs.onCreated.addListener(scheduleInit);
chrome.tabs.onRemoved.addListener(scheduleInit);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.pinned !== undefined || changeInfo.title) {
        scheduleInit();
    }
});
chrome.tabs.onMoved.addListener(scheduleInit);
chrome.tabs.onAttached.addListener(scheduleInit);
chrome.tabs.onDetached.addListener(scheduleInit);
