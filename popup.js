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
        e.dataTransfer.setData('text/plain', tab.id);
        e.dataTransfer.effectAllowed = 'move';
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
        const sourceTabId = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const sourceTab = allTabs.find(t => t.id === sourceTabId);

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

        const sourceTabId = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const sourceTab = allTabs.find(t => t.id === sourceTabId);

        if (!sourceTab || sourceTab.pinned !== tab.pinned) {
            return;
        }

        if (sourceTabId === tab.id) return;

        const rect = tabItem.getBoundingClientRect();
        const isNearTop = e.clientY < rect.top + rect.height / 2;
        let newIndex = tab.index;

        if (sourceTab.windowId === tab.windowId && sourceTab.index < tab.index) {
            newIndex--;
        }
        
        if (!isNearTop) {
            newIndex++;
        }

        try {
            await chrome.tabs.move(sourceTabId, { windowId: parseInt(windowId, 10), index: newIndex });
            scheduleInit();
        } catch (error) {
            console.error("Error moving tab:", error);
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
    console.log('[Init] Start');
    try {
        const allTabsFromAPI = await chrome.tabs.query({});
        const { windowNames } = await chrome.storage.local.get('windowNames');
        const names = windowNames || {};
        console.log('  > Names loaded from storage:', names);

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
