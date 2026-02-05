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
async function renderTabs(groupedTabs, totalTabCount) {
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
    document.getElementById('tab-count').textContent = `共 ${totalTabCount} 个标签页`;

    const urlCounts = Object.values(groupedTabs).flat().reduce((acc, tab) => {
        if (tab.url) {
            acc[tab.url] = (acc[tab.url] || 0) + 1;
        }
        return acc;
    }, {});

    // Use the stored popup window ID for sorting
    const windowIds = Object.keys(groupedTabs).sort((a, b) => {
        if (parseInt(a) === currentPopupWinId) return -1; // Popup's window first
        if (parseInt(b) === currentPopupWinId) return 1;
        return parseInt(a) - parseInt(b);
    });

    for (const windowId of windowIds) {
        const tabs = groupedTabs[windowId];

        const windowContainer = document.createElement('div');
        windowContainer.className = 'window-container';
        windowContainer.dataset.windowId = windowId;

        const windowHeader = document.createElement('div');
        windowHeader.className = 'window-header';
        const isCurrent = parseInt(windowId) === currentPopupWinId;
        
        const windowTitle = document.createElement('span');
        windowTitle.textContent = `窗口 ${windowIds.indexOf(windowId) + 1}` + (isCurrent ? ' (当前窗口)' : '');

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

        windowHeader.appendChild(windowTitle);
        windowHeader.appendChild(closeWindowBtn);

        if (isCurrent) {
            windowHeader.classList.add('current-window');
        }
        windowContainer.appendChild(windowHeader);

        const tabList = document.createElement('div');
        tabList.className = 'tab-list';

        // Add drop zone listeners
        tabList.addEventListener('dragover', (e) => {
            e.preventDefault(); // Allow drop
            tabList.classList.add('drag-over');
        });

        tabList.addEventListener('dragleave', () => {
            tabList.classList.remove('drag-over');
        });

        tabList.addEventListener('drop', async (e) => {
            e.preventDefault();
            tabList.classList.remove('drag-over');
            const tabId = parseInt(e.dataTransfer.getData('text/plain'), 10);
            const targetWindowId = parseInt(windowId, 10);

            try {
                // Check if the target window has only a new tab page
                const targetTabs = await chrome.tabs.query({ windowId: targetWindowId });
                let tabToClose = null;
                if (targetTabs.length === 1 && (targetTabs[0].url.startsWith('chrome://newtab') || targetTabs[0].url.startsWith('edge://newtab'))) {
                    tabToClose = targetTabs[0].id;
                }

                // Move the tab
                await chrome.tabs.move(tabId, { windowId: targetWindowId, index: -1 });

                // If we found a 'new tab' to replace, close it
                if (tabToClose) {
                    await chrome.tabs.remove(tabToClose);
                }

                // Make the moved tab active
                await chrome.tabs.update(tabId, { active: true });
                scheduleInit(); // Refresh the entire UI
            } catch (error) {
                console.error(`Could not move tab ${tabId} to window ${targetWindowId}:`, error);
            }
        });

        for (const tab of tabs) {
            const tabItem = document.createElement('div');
            tabItem.className = 'tab-item';
            tabItem.draggable = true; // Make tab items draggable

            // Drag and Drop event listeners
            tabItem.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', tab.id);
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => tabItem.classList.add('dragging'), 0);
            });

            tabItem.addEventListener('dragend', () => {
                tabItem.classList.remove('dragging');
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
                    // No need to call scheduleInit() here, as the onRemoved listener will handle it.
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
                
                // New: Add tooltip and click event for closing duplicates
                duplicateBadge.addEventListener('mouseover', (e) => showTooltip(`存在 ${urlCounts[tab.url]} 个相同标签页，点击关闭其余`, e));
                duplicateBadge.addEventListener('mouseout', hideTooltip);
                duplicateBadge.onclick = async (e) => {
                    e.stopPropagation(); // Prevent the click from bubbling up to the tab item
                    
                    // Find all tabs with the same URL
                    const tabsToClose = await chrome.tabs.query({ url: tab.url });
                    
                    if (tabsToClose.length > 1) {
                        // Keep the first tab, close the rest
                        const tabIdsToClose = tabsToClose.slice(1).map(t => t.id);
                        await chrome.tabs.remove(tabIdsToClose);
                        // The onRemoved listener will automatically trigger a UI refresh
                    }
                };

                tabItem.appendChild(duplicateBadge);
            }

            tabItem.appendChild(pinBtn);
            tabItem.appendChild(closeBtn);
            tabList.appendChild(tabItem);
        }
        windowContainer.appendChild(tabList);
        tabsContainer.appendChild(windowContainer);

        // Restore scroll position
        if (scrollPositions[windowId]) {
            // Use setTimeout to ensure the DOM is ready
            setTimeout(() => {
                tabList.scrollTop = scrollPositions[windowId];
            }, 0);
        }
    }
}

// Fetches, sorts, and caches all tabs, then triggers the initial render
async function init() {
    if (isInitializing) return;
    isInitializing = true;
    try {
        const allTabsFromAPI = await chrome.tabs.query({}); // Get tabs from all windows

        allTabsFromAPI.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return a.id - b.id; // Fallback sort by tab ID
        });

        allTabs = allTabsFromAPI; // Cache for search

        const searchBox = document.getElementById('search-box');
        const searchTerm = searchBox.value.toLowerCase();
        let tabsToRender = allTabs;

        if (searchTerm) {
            tabsToRender = allTabs.filter(tab => {
                const title = tab.title.toLowerCase();
                const url = (tab.url || '').toLowerCase();
                return title.includes(searchTerm) || url.includes(searchTerm);
            });
        }

        // Group tabs by window ID
        const groupedTabs = tabsToRender.reduce((acc, tab) => {
            const windowId = tab.windowId;
            if (!acc[windowId]) {
                acc[windowId] = [];
            }
            acc[windowId].push(tab);
            return acc;
        }, {});

        await renderTabs(groupedTabs, allTabs.length);
    } finally {
        isInitializing = false;
    }
}

let isInitialized = false; // Flag to prevent multiple initializations

// Initial setup when the popup is opened
document.addEventListener('DOMContentLoaded', async () => {
    // Festive animation for Chinese New Year
    function createFestiveElement() {
        const elements = ['🐎', '🏮', '🧧', '✨'];
        const element = document.createElement('div');
        element.classList.add('festive-element');
        element.textContent = elements[Math.floor(Math.random() * elements.length)];
        
        // Random size
        element.style.fontSize = Math.random() * 20 + 15 + 'px';

        // Make elements fall from the sides, avoiding the center
        let leftPosition = Math.random() * 35; // 0% to 35%
        if (Math.random() > 0.5) {
            leftPosition += 65; // Shift to the right side (65% to 100%)
        }
        element.style.left = leftPosition + 'vw';

        const duration = Math.random() * 6 + 6; // Duration between 6 and 12 seconds
        element.style.animationDuration = duration + 's';
        
        document.body.appendChild(element);
        
        // Remove the element after it falls
        setTimeout(() => {
            element.remove();
        }, duration * 1000);
    }

    // Create a burst of festive elements
    for (let i = 0; i < 30; i++) { // Increased the count for more festivity
        setTimeout(createFestiveElement, Math.random() * 3000);
    }

    // Store the window ID when the popup is opened
    const currentWindow = await chrome.windows.getCurrent();
    currentPopupWinId = currentWindow.id;

    if (isInitialized) {
        return; // If already initialized, do nothing
    }
    isInitialized = true; // Set the flag

    // "Close all non-pinned" button logic
document.getElementById('close-all-btn').onclick = async () => {
    // Close non-pinned tabs across all windows
    const tabsToClose = await chrome.tabs.query({ pinned: false });
    const tabIds = tabsToClose.map(tab => tab.id);
    if (tabIds.length > 0) {
        await chrome.tabs.remove(tabIds);
    }
    scheduleInit();
};

const searchBox = document.getElementById('search-box');

searchBox.addEventListener('input', () => {
    const searchTerm = searchBox.value.toLowerCase();
    const filteredTabs = allTabs.filter(tab => {
        const title = tab.title.toLowerCase();
        const url = (tab.url || '').toLowerCase();
        return title.includes(searchTerm) || url.includes(searchTerm);
    });

    // Group tabs by window ID for rendering
    const groupedTabs = filteredTabs.reduce((acc, tab) => {
        const windowId = tab.windowId;
        if (!acc[windowId]) {
            acc[windowId] = [];
        }
        acc[windowId].push(tab);
        return acc;
    }, {});

    renderTabs(groupedTabs, allTabs.length);
});

const addWindowBtn = document.getElementById('add-window-btn');
addWindowBtn.addEventListener('click', () => {
    console.log('Popup: Sending createNewWindow message at ' + new Date().toLocaleTimeString());
    chrome.runtime.sendMessage({ action: 'createNewWindow' });
});
addWindowBtn.addEventListener('mouseover', (e) => showTooltip('新建窗口', e));
addWindowBtn.addEventListener('mouseout', hideTooltip);

// Listen for window and tab changes to keep the UI in sync
chrome.windows.onCreated.addListener(scheduleInit);
chrome.tabs.onCreated.addListener(scheduleInit);
chrome.tabs.onRemoved.addListener(scheduleInit);

scheduleInit(); // Initial load
});