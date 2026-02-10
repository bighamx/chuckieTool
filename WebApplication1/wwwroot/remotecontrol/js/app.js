// Remote Control - Frontend Application

class RemoteControl {
    constructor() {
        this.token = localStorage.getItem('token');
        this.username = localStorage.getItem('username') || '';
        this.websocket = null;
        /** 远程控制键鼠 WebSocket，在开始/停止远程时建立/断开 */
        this.inputSocket = null;
        this.autoRefreshInterval = null;
        this.sysInfoRefreshInterval = null;
        this.processes = [];
        this.processSearchTerm = '';
        this.processFilter = 'all'; // 'all' | 'windowed' | 'background'
        this.processSortColumn = null;  // 'name' | 'pid' | 'cpu' | 'memory' | null
        this.processSortAsc = true;
        /** 容器列表排序：'name' | 'image' | 'state' | 'cpu' | 'memory' | 'ports' | null */
        this.containerSortColumn = null;
        this.containerSortAsc = true;
        /** 容器列表数据（用于排序与重绘） */
        this.containers = [];
        this.containerStats = [];
        this.currentPath = null;
        /** 当前目录文件列表（用于排序与重绘） */
        this.files = [];
        /** 文件列表排序：'name' | 'type' | 'size' | 'date' | null */
        this.fileSortColumn = null;
        this.fileSortAsc = true;
        /** 名称列四种模式：0=文件夹在前+升序 1=文件夹在前+降序 2=混合+升序 3=混合+降序 */
        this.fileSortNameMode = 0;
        /** 当前目录下的图片文件列表，用于预览上一张/下一张 */
        this.currentDirImageFiles = [];
        this.previewImageIndex = -1;
        /** 当前目录下的视频文件列表，用于预览上一个/下一个 */
        this.currentDirVideoFiles = [];
        this.previewVideoIndex = -1;
        /** Compose 文件选择器当前路径 */
        this.pickerCurrentPath = null;
        // previewObjectUrl 不再需要，视频和图片均通过 URL 直接加载
        this.streamActive = false;
        this.currentStreamMode = 'none'; // 'none', 'h264', 'mjpeg'
        /** 实时流统计：FPS、缓冲延迟(ms)、接收速率(kbps)，由各拉流路径更新 */
        this.streamStats = { fps: 0, bufferDelayMs: 0, bitrateKbps: 0 };
        this.streamStatsFrameCount = 0;
        this.streamStatsFrameCountStart = 0;
        this.streamStatsBytes = 0;
        this.streamStatsBytesStart = 0;
        this.streamStatsInterval = null;
        this.qualitySettings = {
            resolution: '1280x720',
            bitrate: '3M',
            maxrate: '5M',
            crf: '18'
        };
        // Theme
        this.theme = 'dark';
        this.themeIcons = {
            dark: '☀️',
            light: '🌙'
        };
        // 鼠标拖动状态
        this.isDragging = false;
        this.dragButton = 0;
        this.lastMoveTime = 0;
        this.moveThrottleMs = 16; // 约60fps的节流
        // 全屏状态
        this.isFullscreen = false;
        // 可编辑的文本文件扩展名列表
        this.editableExtensions = [
            // 代码文件
            'txt', 'js', 'ts', 'jsx', 'tsx', 'json', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
            'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'scala',
            'sh', 'bash', 'ps1', 'bat', 'cmd', 'vbs',
            // 配置文件
            'yaml', 'yml', 'toml', 'ini', 'conf', 'config', 'env',
            // 文档文件
            'md', 'markdown', 'rst', 'tex', 'log',
            // Web 相关
            'svg', 'vue', 'aspx', 'cshtml', 'razor',
            // 数据文件
            'csv', 'tsv', 'sql',
            // 其他
            'gitignore', 'gitattributes', 'editorconfig', 'dockerfile'
        ];
        this.commandHistory = [];
        this.historyIndex = -1;
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkAuth();
        this.initTheme();
        this.initDialog();
    }

    initDialog() {
        const dialog = document.getElementById('custom-dialog');
        const closeBtn = document.getElementById('dialog-close-btn');
        const okBtn = document.getElementById('dialog-ok-btn');
        const cancelBtn = document.getElementById('dialog-cancel-btn');

        // 关闭按钮
        closeBtn.addEventListener('click', () => this.hideDialog());

        // 确定和取消按钮会在 showDialog 中动态设置
    }

    initTheme() {
        // Check for saved theme
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            this.theme = savedTheme;
        } else {
            // Check system preference
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                this.theme = 'light';
            }
        }

        this.applyTheme();
    }

    toggleTheme() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', this.theme);
        this.applyTheme();
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        const toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) {
            toggleBtn.textContent = this.themeIcons[this.theme];
            toggleBtn.title = this.theme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
        }
    }

    showDialog(message, title = '提示', options = {}) {
        const dialog = document.getElementById('custom-dialog');
        const dialogContainer = dialog?.querySelector('.dialog-container');
        const titleEl = document.getElementById('dialog-title');
        const messageEl = document.getElementById('dialog-message');
        const logsEl = document.getElementById('dialog-logs');
        const okBtn = document.getElementById('dialog-ok-btn');
        const cancelBtn = document.getElementById('dialog-cancel-btn');

        // 设置标题和消息
        titleEl.textContent = title;
        messageEl.textContent = message;
        messageEl.style.display = 'block';

        // 处理日志显示
        if (options.logs) {
            logsEl.textContent = options.logs;
            logsEl.style.display = 'block';
            if (dialogContainer) {
                dialogContainer.classList.add('dialog-wide');
            }
        } else {
            logsEl.style.display = 'none';
            if (dialogContainer) {
                dialogContainer.classList.remove('dialog-wide');
            }
        }

        // 返回 Promise 以支持 confirm 类型
        return new Promise((resolve) => {
            if (options.type === 'confirm') {
                cancelBtn.style.display = 'inline-flex';

                okBtn.onclick = () => {
                    this.hideDialog();
                    resolve(true);
                };

                cancelBtn.onclick = () => {
                    this.hideDialog();
                    resolve(false);
                };
            } else {
                cancelBtn.style.display = 'none';

                okBtn.onclick = () => {
                    this.hideDialog();
                    resolve(true);
                };
            }

            dialog.style.display = 'flex';
        });
    }

    hideDialog() {
        const dialog = document.getElementById('custom-dialog');
        dialog.style.display = 'none';
    }

    /**
     * 显示 Compose 实时日志弹窗并消费流式响应
     * @param {string} title 弹窗标题（如 "Compose Pull"）
     * @param {string} streamUrl 流式 API 地址（如 /api/docker/compose/pull/stream）
     * @param {object} body 请求体 { composePath }
     * @param {() => void} [onDone] 流结束后的回调（如刷新状态）
     */
    async showComposeStreamLog(title, streamUrl, body, onDone) {
        const dialog = document.getElementById('compose-log-dialog');
        const titleEl = document.getElementById('compose-log-title');
        const pre = document.getElementById('compose-log-content');
        const closeBtn = document.getElementById('compose-log-close-btn-footer');
        if (!dialog || !titleEl || !pre || !closeBtn) return;

        titleEl.textContent = title + ' — 运行中...';
        pre.textContent = '';
        closeBtn.disabled = true;
        dialog.style.display = 'flex';

        const appendLine = (line) => {
            pre.textContent += line + '\n';
            pre.scrollTop = pre.scrollHeight;
        };

        try {
            const response = await fetch(streamUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const text = await response.text();
                appendLine(text || `HTTP ${response.status}`);
                titleEl.textContent = title + ' — 失败';
                closeBtn.disabled = false;
                if (onDone) onDone();
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let exitCode = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.startsWith('[EXIT:')) {
                        const m = line.match(/\[EXIT:(-?\d+)\]/);
                        exitCode = m ? parseInt(m[1], 10) : null;
                    } else {
                        appendLine(line);
                    }
                }
            }
            if (buffer.startsWith('[EXIT:')) {
                const m = buffer.match(/\[EXIT:(-?\d+)\]/);
                exitCode = m ? parseInt(m[1], 10) : null;
            } else if (buffer) {
                appendLine(buffer);
            }

            const success = exitCode === 0;
            titleEl.textContent = title + (success ? ' — 完成' : ` — 退出码 ${exitCode ?? '?'}`);
            if (onDone) onDone();
        } catch (error) {
            appendLine('错误: ' + error.message);
            titleEl.textContent = title + ' — 错误';
            if (onDone) onDone();
        } finally {
            closeBtn.disabled = false;
        }
    }

    hideComposeLogDialog() {
        const dialog = document.getElementById('compose-log-dialog');
        if (dialog) dialog.style.display = 'none';
    }

    /**
     * 轻量级 toast 提示（自动消失）
     * @param {string} message 提示文案
     * @param {string} type 'success' | 'info' | 'warning' | 'error'
     * @param {number} duration 显示时长（毫秒）
     */
    showToast(message, type = 'info', duration = 2500) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-8px)';
            toast.style.transition = 'opacity 0.2s, transform 0.2s';
            setTimeout(() => toast.remove(), 200);
        }, duration);
    }

    bindEvents() {


        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        // Theme Toggle
        document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());

        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // Control cards
        document.querySelectorAll('.control-card').forEach(card => {
            card.addEventListener('click', async (e) => {
                const action = e.currentTarget.dataset.action;
                if (action === 'shutdown') {
                    const confirmed = await this.showDialog(
                        '确定要关闭计算机吗？',
                        '确认关机',
                        { type: 'confirm' }
                    );
                    if (confirmed) {
                        this.executeAction(action);
                    }
                } else if (action === 'sleep') {
                    const confirmed = await this.showDialog(
                        '确定要使计算机进入睡眠状态吗？',
                        '确认睡眠',
                        { type: 'confirm' }
                    );
                    if (confirmed) {
                        this.executeAction(action);
                    }
                } else if (action === 'hibernate') {
                    const confirmed = await this.showDialog(
                        '确定要使计算机休眠吗？',
                        '确认休眠',
                        { type: 'confirm' }
                    );
                    if (confirmed) {
                        this.executeAction(action);
                    }
                } else {
                    this.executeAction(action);
                }
            });
        });

        // Screenshot / Remote Control - 切换按钮
        document.getElementById('stream-toggle-btn').addEventListener('click', () => this.toggleStream());

        // 全屏按钮事件
        const fullscreenBtn = document.getElementById('fullscreen-btn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        }

        // 画质预设下拉框事件
        const qualityPreset = document.getElementById('quality-preset');
        if (qualityPreset) {
            qualityPreset.addEventListener('change', (e) => {
                this.updateQualitySettings(e.target.value);
            });
        }

        // 分辨率下拉框事件
        const resolutionSelect = document.getElementById('resolution-select');
        if (resolutionSelect) {
            resolutionSelect.addEventListener('change', (e) => {
                this.qualitySettings.resolution = e.target.value;
                this.checkAndUpdatePreset();
                console.log('Resolution changed to:', e.target.value);
            });
        }

        // 码率下拉框事件
        const bitrateSelect = document.getElementById('bitrate-select');
        if (bitrateSelect) {
            bitrateSelect.addEventListener('change', (e) => {
                this.qualitySettings.bitrate = e.target.value;
                // 同时更新 maxrate 为略高于 bitrate 的值
                const bitrateMap = {
                    '10M': '15M', '8M': '10M', '5M': '8M', '3M': '5M',
                    '2M': '3M', '1M': '2M', '500k': '1M'
                };
                this.qualitySettings.maxrate = bitrateMap[e.target.value] || '5M';
                this.checkAndUpdatePreset();
                console.log('Bitrate changed to:', e.target.value, 'maxrate:', this.qualitySettings.maxrate);
            });
        }

        // CRF 滑块实时更新显示值和设置
        const crfSlider = document.getElementById('crf-value');
        const crfDisplay = document.getElementById('crf-display');
        if (crfSlider && crfDisplay) {
            crfSlider.addEventListener('input', (e) => {
                crfDisplay.textContent = e.target.value;
                this.qualitySettings.crf = e.target.value;
                this.checkAndUpdatePreset();
            });
        }

        // Add event listeners for canvas, video, and image elements
        const streamCanvas = document.getElementById('stream-canvas');
        const streamVideo = document.getElementById('stream-video');
        const streamImg = document.getElementById('stream-img');

        // Bind mouse events to all stream display elements.
        // 左键仅用 mouse-down + mouse-up 传递，不监听 click，否则一次点击会变成 down+up+click(又一次 down+up) 导致双击。
        for (const el of [streamCanvas, streamVideo, streamImg]) {
            el.addEventListener('contextmenu', (e) => this.handleRemoteRightClick(e));
            el.addEventListener('auxclick', (e) => this.handleRemoteMiddleClick(e));
            el.addEventListener('dragstart', (e) => e.preventDefault());
            el.addEventListener('mousedown', (e) => this.handleRemoteMouseDown(e));
            el.addEventListener('mousemove', (e) => this.handleRemoteMouseMove(e));
            el.addEventListener('mouseup', (e) => this.handleRemoteMouseUp(e));
            el.addEventListener('mouseleave', (e) => this.handleRemoteMouseUp(e));
            el.addEventListener('wheel', (e) => this.handleRemoteWheel(e), { passive: false });
        }

        // 键盘事件（需要聚焦到流画面区域时有效）
        document.addEventListener('keydown', (e) => this.handleRemoteKeydown(e));
        document.addEventListener('keyup', (e) => this.handleRemoteKeyup(e));

        // 全屏快捷键处理 (F11 切换全屏, Esc 退出全屏)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F11') {
                e.preventDefault();
                this.toggleFullscreen();
            } else if (e.key === 'Escape' && this.isFullscreen) {
                e.preventDefault();
                this.exitFullscreen();
            }
        });

        // Terminal
        document.getElementById('terminal-toggle-btn').addEventListener('click', () => this.toggleTerminal());
        document.getElementById('clear-btn').addEventListener('click', () => this.clearTerminal());
        document.getElementById('terminal-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.sendCommand();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateHistory('up');
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.navigateHistory('down');
            }
        });

        // System Info
        document.getElementById('refresh-info-btn').addEventListener('click', () => this.loadSystemInfo());
        document.getElementById('sysinfo-auto-refresh').addEventListener('change', (e) => {
            if (e.target.checked) {
                this.startSysInfoAutoRefresh();
            } else {
                this.stopSysInfoAutoRefresh();
            }
        });

        // Process Manager
        document.getElementById('refresh-processes-btn').addEventListener('click', () => this.loadProcesses());
        document.getElementById('process-search').addEventListener('input', (e) => {
            this.processSearchTerm = e.target.value.toLowerCase();
            this.renderProcesses();
        });
        document.getElementById('process-filter').addEventListener('change', (e) => {
            this.processFilter = e.target.value;
            this.renderProcesses();
        });
        // 排序点击
        document.querySelectorAll('.processes-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (this.processSortColumn === col) {
                    this.processSortAsc = !this.processSortAsc;
                } else {
                    this.processSortColumn = col;
                    this.processSortAsc = col === 'name'; // 名称默认升序，数值默认降序
                }
                this.updateSortArrows();
                this.renderProcesses();
            });
        });

        // Docker Container Management (docker-tab)
        const refreshContainersBtn = document.getElementById('refresh-containers-btn');
        if (refreshContainersBtn) {
            refreshContainersBtn.addEventListener('click', () => this.loadDockerContainers());
        }
        const containerSearch = document.getElementById('container-search');
        if (containerSearch) {
            containerSearch.addEventListener('input', () => this.loadDockerContainers());
        }
        document.querySelectorAll('.containers-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (this.containerSortColumn === col) {
                    this.containerSortAsc = !this.containerSortAsc;
                } else {
                    this.containerSortColumn = col;
                    this.containerSortAsc = col === 'name' || col === 'image' || col === 'ports'; // 文本列默认升序，数值默认降序
                }
                this.updateContainerSortArrows();
                this.renderDockerContainers();
                if (this.containers.length > 0 && this.containerStats.length > 0) this.updateContainerStats(this.containerStats);
            });
        });
        const refreshDockerInfoBtn = document.getElementById('refresh-docker-info-btn');
        if (refreshDockerInfoBtn) {
            refreshDockerInfoBtn.addEventListener('click', () => this.loadDockerInfo());
        }

        // Docker Images Management (images-tab)
        const refreshImagesBtn = document.getElementById('refresh-images-btn');
        if (refreshImagesBtn) {
            refreshImagesBtn.addEventListener('click', () => this.loadDockerImages());
        }
        const pullImageBtn = document.getElementById('pull-image-btn');
        if (pullImageBtn) {
            pullImageBtn.addEventListener('click', () => this.pullDockerImage());
        }

        // Docker Compose Management (compose-tab)
        const loadComposeBtn = document.getElementById('load-compose-btn');
        if (loadComposeBtn) {
            loadComposeBtn.addEventListener('click', () => this.loadComposeFile());
        }
        const browseComposeBtn = document.getElementById('browse-compose-btn');
        if (browseComposeBtn) {
            browseComposeBtn.addEventListener('click', () => this.openComposeFilePicker());
        }
        const newComposeBtn = document.getElementById('new-compose-btn');
        if (newComposeBtn) {
            newComposeBtn.addEventListener('click', () => this.newComposeFile());
        }
        const saveComposeBtn = document.getElementById('save-compose-btn');
        if (saveComposeBtn) {
            saveComposeBtn.addEventListener('click', () => this.saveComposeFile());
        }
        const runComposeUpBtn = document.getElementById('run-compose-up-btn');
        if (runComposeUpBtn) {
            runComposeUpBtn.addEventListener('click', () => this.runComposeUp());
        }
        const runComposeDownBtn = document.getElementById('run-compose-down-btn');
        if (runComposeDownBtn) {
            runComposeDownBtn.addEventListener('click', () => this.runComposeDown());
        }
        const validateComposeBtn = document.getElementById('validate-compose-btn');
        if (validateComposeBtn) {
            validateComposeBtn.addEventListener('click', () => this.validateCompose());
        }
        const refreshComposeStatusBtn = document.getElementById('refresh-compose-status-btn');
        if (refreshComposeStatusBtn) {
            refreshComposeStatusBtn.addEventListener('click', () => this.loadComposeStatus());
        }
        const showComposeLogsBtn = document.getElementById('show-compose-logs-btn');
        if (showComposeLogsBtn) {
            showComposeLogsBtn.addEventListener('click', () => this.showComposeLogs());
        }
        const runComposePullBtn = document.getElementById('run-compose-pull-btn');
        if (runComposePullBtn) {
            runComposePullBtn.addEventListener('click', () => this.runComposePull());
        }

        // Compose 实时日志弹窗关闭
        const composeLogCloseBtn = document.getElementById('compose-log-close-btn');
        const composeLogCloseBtnFooter = document.getElementById('compose-log-close-btn-footer');
        if (composeLogCloseBtn) composeLogCloseBtn.addEventListener('click', () => this.hideComposeLogDialog());
        if (composeLogCloseBtnFooter) composeLogCloseBtnFooter.addEventListener('click', () => this.hideComposeLogDialog());
        // Compose 文件选择对话框
        const composePickerClose = document.getElementById('compose-picker-close-btn');
        if (composePickerClose) composePickerClose.addEventListener('click', () => this.closeComposeFilePicker());
        const composePickerCancel = document.getElementById('compose-picker-cancel-btn');
        if (composePickerCancel) composePickerCancel.addEventListener('click', () => this.closeComposeFilePicker());
        const pickerHomeBtn = document.getElementById('picker-home-btn');
        if (pickerHomeBtn) pickerHomeBtn.addEventListener('click', () => this.pickerNavigateHome());
        const pickerBackBtn = document.getElementById('picker-back-btn');
        if (pickerBackBtn) pickerBackBtn.addEventListener('click', () => this.pickerNavigateBack());
        const pickerRefreshBtn = document.getElementById('picker-refresh-btn');
        if (pickerRefreshBtn) pickerRefreshBtn.addEventListener('click', () => this.loadPickerFiles(this.pickerCurrentPath));
        // File Management
        const refreshFilesBtn = document.getElementById('refresh-files-btn');
        if (refreshFilesBtn) {
            refreshFilesBtn.addEventListener('click', () => {
                const path = this.currentPath || null;
                this.loadFiles(path);
            });
        }
        const homeBtn = document.getElementById('home-btn');
        if (homeBtn) {
            homeBtn.addEventListener('click', () => this.navigateToHome());
        }
        const backBtn = document.getElementById('back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.navigateBack());
        }
        const createFolderBtn = document.getElementById('create-folder-btn');
        const createDropdown = document.getElementById('create-dropdown');
        if (createFolderBtn) {
            createFolderBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (createDropdown) {
                    createDropdown.style.display = createDropdown.style.display === 'none' ? 'block' : 'none';
                }
            });
        }
        if (createDropdown) {
            createDropdown.querySelectorAll('.create-dropdown-item').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.hideCreateDropdown();
                    const action = el.dataset.action;
                    if (action === 'file') {
                        const name = prompt('输入新文件名称:');
                        if (name) this.createFile(name);
                    } else if (action === 'folder') {
                        const name = prompt('输入新文件夹名称:');
                        if (name) this.createFolder(name);
                    }
                });
            });
        }
        const fileUploadBtn = document.getElementById('file-upload');
        if (fileUploadBtn) {
            fileUploadBtn.addEventListener('change', () => this.uploadFile());
        }

        // 收藏夹
        const bookmarkAddBtn = document.getElementById('bookmark-add-btn');
        if (bookmarkAddBtn) {
            bookmarkAddBtn.addEventListener('click', () => this.addBookmark());
        }
        const bookmarkListBtn = document.getElementById('bookmark-list-btn');
        if (bookmarkListBtn) {
            bookmarkListBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleBookmarkDropdown();
            });
        }
        // 点击其他地方关闭收藏夹、新建下拉
        document.addEventListener('click', () => {
            this.hideBookmarkDropdown();
            this.hideCreateDropdown();
        });

        // 面包屑可编辑：点击空白区进入编辑模式
        const breadcrumbBlank = document.getElementById('breadcrumb-blank');
        if (breadcrumbBlank) {
            breadcrumbBlank.addEventListener('click', () => this.enterBreadcrumbEditMode());
        }
        const breadcrumbInput = document.getElementById('breadcrumb-input');
        if (breadcrumbInput) {
            breadcrumbInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.navigateFromBreadcrumbInput();
                } else if (e.key === 'Escape') {
                    this.exitBreadcrumbEditMode();
                }
            });
            breadcrumbInput.addEventListener('blur', () => this.exitBreadcrumbEditMode());
        }
        const breadcrumbRefreshBtn = document.getElementById('breadcrumb-refresh-btn');
        if (breadcrumbRefreshBtn) {
            breadcrumbRefreshBtn.addEventListener('click', () => {
                this.loadFiles(this.currentPath || null);
            });
        }
        document.querySelectorAll('.files-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (col === 'name') {
                    if (this.fileSortColumn !== 'name') {
                        this.fileSortColumn = 'name';
                        this.fileSortNameMode = 0;
                    } else {
                        this.fileSortNameMode = (this.fileSortNameMode + 1) % 4;
                    }
                } else {
                    if (this.fileSortColumn === col) {
                        this.fileSortAsc = !this.fileSortAsc;
                    } else {
                        this.fileSortColumn = col;
                        this.fileSortAsc = col === 'type';
                    }
                }
                this.updateFilesSortArrows();
                this.renderFilesList();
            });
        });
        const editorSaveBtn = document.getElementById('editor-save-btn');
        if (editorSaveBtn) {
            editorSaveBtn.addEventListener('click', () => this.saveFile());
        }
        const editorCloseBtn = document.getElementById('editor-close-btn');
        if (editorCloseBtn) {
            editorCloseBtn.addEventListener('click', () => this.closeFileEditor());
        }
        document.querySelectorAll('.editor-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (mode) this.switchEditorMode(mode);
            });
        });

        // File Preview
        const previewCloseBtn = document.getElementById('preview-close-btn');
        if (previewCloseBtn) {
            previewCloseBtn.addEventListener('click', () => this.closePreview());
        }
        const previewCloseFooterBtn = document.getElementById('preview-close-footer-btn');
        if (previewCloseFooterBtn) {
            previewCloseFooterBtn.addEventListener('click', () => this.closePreview());
        }

        const previewPrevBtn = document.getElementById('preview-prev-btn');
        if (previewPrevBtn) {
            previewPrevBtn.addEventListener('click', (e) => { e.stopPropagation(); this.previewPrevImage(); });
        }
        const previewNextBtn = document.getElementById('preview-next-btn');
        if (previewNextBtn) {
            previewNextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.previewNextImage(); });
        }
        const previewImageEl = document.getElementById('preview-image');
        if (previewImageEl) {
            previewImageEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.previewNextImage();
            });
        }
        const previewVideoPrevBtn = document.getElementById('preview-video-prev-btn');
        if (previewVideoPrevBtn) {
            previewVideoPrevBtn.addEventListener('click', (e) => { e.stopPropagation(); this.previewPrevVideo(); });
        }
        const previewVideoNextBtn = document.getElementById('preview-video-next-btn');
        if (previewVideoNextBtn) {
            previewVideoNextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.previewNextVideo(); });
        }

        // 文件编辑器与预览仅通过关闭按钮关闭，不响应点击背景

        // 右键菜单 - 点击外部关闭
        document.addEventListener('click', (e) => {
            const contextMenu = document.getElementById('context-menu');
            if (contextMenu && !contextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });
    }

    checkAuth() {
        if (this.token) {
            // 立即显示仪表板
            this.showDashboard();
            // 后台验证 token
            fetch(`/api/auth/validate?token=${this.token}`)
                .then(res => res.json())
                .then(data => {
                    if (!data.valid) {
                        this.logout();
                    }
                })
                .catch(() => {
                    // 网络错误，保留 token 和仪表板
                });
        } else {
            // 尝试通过 Cookie 验证 (调用 /api/auth/me)
            fetch('/api/auth/me')
                .then(res => {
                    if (res.ok) return res.json();
                    throw new Error('Unauthorized');
                })
                .then(data => {
                    this.username = data.username;
                    this.showDashboard();
                })
                .catch(() => {
                    // 没有 token 且 Cookie 无效，跳转到全局登录页面
                    window.location.href = '/Account/Login';
                });
        }
    }



    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
        this.stopSysInfoAutoRefresh();
    }

    startSysInfoAutoRefresh() {
        this.stopSysInfoAutoRefresh();
        this.sysInfoRefreshInterval = setInterval(() => this.loadSystemInfo(), 3000);
    }

    stopSysInfoAutoRefresh() {
        if (this.sysInfoRefreshInterval) {
            clearInterval(this.sysInfoRefreshInterval);
            this.sysInfoRefreshInterval = null;
        }
    }

    logout() {
        this.token = null;
        this.username = '';
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        this.disconnectTerminal();
        this.stopAutoRefresh();
        window.location.href = '/Account/Logout';
    }

    showDashboard() {
        document.getElementById('dashboard-page').classList.add('active');
        // 显示用户名
        if (this.username) {
            document.getElementById('user-info').textContent = `欢迎, ${this.username}`;
        }

        // 尝试从 URL hash 恢复状态
        const restored = this.restoreFromHash();

        if (!restored) {
            // 默认行为：加载系统信息
            this.currentTab = 'controls';
            this.loadSystemInfo();
            // 默认开启系统信息自动刷新
            const autoRefreshCheckbox = document.getElementById('sysinfo-auto-refresh');
            if (autoRefreshCheckbox && autoRefreshCheckbox.checked) {
                this.startSysInfoAutoRefresh();
            }
            this.renderComposeHistory();
        }

        // 监听 hash 变化（浏览器前进/后退）
        window.addEventListener('hashchange', () => {
            this.restoreFromHash();
        });
    }

    switchTab(tabName, skipHashUpdate = false) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}-tab`).classList.add('active');

        // 记录当前 tab
        this.currentTab = tabName;

        // 切换到非 controls 页签时停止系统信息自动刷新
        if (tabName !== 'controls') {
            this.stopSysInfoAutoRefresh();
        }

        if (tabName === 'controls') {
            // Load system info when controls tab is shown
            this.loadSystemInfo();
            const autoRefreshCheckbox = document.getElementById('sysinfo-auto-refresh');
            if (autoRefreshCheckbox && autoRefreshCheckbox.checked) {
                this.startSysInfoAutoRefresh();
            }
        } else if (tabName === 'screenshot') {
            // this.startStream(); // Only start if user explicitly clicks start
        } else if (tabName === 'processes') {
            this.loadProcesses();
        } else if (tabName === 'docker') {
            this.loadDockerInfo();
            this.loadDockerContainers();
        } else if (tabName === 'images') {
            this.loadDockerImages();
        } else if (tabName === 'compose') {
            this.loadComposeStatus();
            this.renderComposeHistory();
        } else if (tabName === 'files') {
            this.loadFiles();
        }

        // 更新 URL hash（除非是从 hash 恢复时调用）
        if (!skipHashUpdate) {
            this.updateHash();
        }
    }

    async executeAction(action) {
        const resultDiv = document.getElementById('action-result');

        try {
            const response = await fetch(`/api/system/${action}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            const data = await response.json();

            resultDiv.textContent = data.message;
            resultDiv.className = 'action-result show ' + (response.ok ? 'success' : 'error');

            setTimeout(() => resultDiv.classList.remove('show'), 5000);
        } catch (error) {
            resultDiv.textContent = '操作失败: ' + error.message;
            resultDiv.className = 'action-result show error';
        }
    }

    // 预设配置（供多个方法共用）
    getQualityPresets() {
        return {
            ultra: { resolution: '1920x1080', bitrate: '8M', maxrate: '10M', crf: '18' },
            high: { resolution: '1280x720', bitrate: '3M', maxrate: '5M', crf: '18' },
            medium: { resolution: '1280x720', bitrate: '2M', maxrate: '3M', crf: '23' },
            low: { resolution: '854x480', bitrate: '1M', maxrate: '2M', crf: '28' }
        };
    }

    // 检查当前参数是否匹配某个预设，并更新预设下拉框
    checkAndUpdatePreset() {
        const presets = this.getQualityPresets();
        const current = this.qualitySettings;
        let matchedPreset = 'custom';

        for (const [name, settings] of Object.entries(presets)) {
            if (settings.resolution === current.resolution &&
                settings.bitrate === current.bitrate &&
                settings.crf === current.crf) {
                matchedPreset = name;
                break;
            }
        }

        const qualityPreset = document.getElementById('quality-preset');
        if (qualityPreset && qualityPreset.value !== matchedPreset) {
            qualityPreset.value = matchedPreset;
            console.log('Preset auto-updated to:', matchedPreset);
        }
    }

    updateQualitySettings(preset) {
        // 如果选择自定义，不做任何改变
        if (preset === 'custom') return;

        const presets = this.getQualityPresets();
        const settings = presets[preset];
        if (settings) {
            this.qualitySettings = { ...settings };

            // 同步更新分辨率下拉框
            const resolutionSelect = document.getElementById('resolution-select');
            if (resolutionSelect) resolutionSelect.value = settings.resolution;

            // 同步更新码率下拉框
            const bitrateSelect = document.getElementById('bitrate-select');
            if (bitrateSelect) bitrateSelect.value = settings.bitrate;

            // 同步更新 CRF 滑块和显示值
            const crfSlider = document.getElementById('crf-value');
            const crfDisplay = document.getElementById('crf-display');
            if (crfSlider) crfSlider.value = settings.crf;
            if (crfDisplay) crfDisplay.textContent = settings.crf;

            console.log(`Quality preset changed to: ${preset}`, this.qualitySettings);

            // 如果流正在运行，提示用户需要重新开始才能生效
            if (this.streamActive) {
                console.log('Note: Quality changes will take effect after restarting the stream');
            }
        }
    }

    // 切换全屏
    toggleFullscreen() {
        if (this.isFullscreen) {
            this.exitFullscreen();
        } else {
            this.enterFullscreen();
        }
    }

    // 进入全屏
    enterFullscreen() {
        const container = document.getElementById('screenshot-container');
        const hint = document.getElementById('fullscreen-exit-hint');
        const btn = document.getElementById('fullscreen-btn');

        if (container) {
            container.classList.add('fullscreen');
            this.isFullscreen = true;
            if (btn) btn.textContent = '⛶ 退出全屏';

            // 显示退出提示
            if (hint) {
                hint.classList.add('show');
                setTimeout(() => hint.classList.remove('show'), 3000);
            }

            console.log('Entered fullscreen mode');
        }
    }

    // 退出全屏
    exitFullscreen() {
        const container = document.getElementById('screenshot-container');
        const btn = document.getElementById('fullscreen-btn');

        if (container) {
            container.classList.remove('fullscreen');
            this.isFullscreen = false;
            if (btn) btn.textContent = '⛶ 全屏';

            console.log('Exited fullscreen mode');
        }
    }

    async startStream() {
        if (this.streamActive) return;

        const canvas = document.getElementById('stream-canvas');
        const video = document.getElementById('stream-video');
        const img = document.getElementById('stream-img');
        const placeholder = document.getElementById('stream-placeholder');
        const toggleBtn = document.getElementById('stream-toggle-btn');

        // 立即进入等待状态，避免重复点击
        toggleBtn.disabled = true;
        toggleBtn.textContent = '⏳ 连接中...';
        toggleBtn.classList.add('btn-loading');

        // Hide all display elements first
        canvas.style.display = 'none';
        video.style.display = 'none';
        img.style.display = 'none';

        console.log('Starting stream with quality settings:', this.qualitySettings);

        const params = new URLSearchParams({
            access_token: this.token,
            resolution: this.qualitySettings.resolution,
            bitrate: this.qualitySettings.bitrate,
            maxrate: this.qualitySettings.maxrate,
            crf: this.qualitySettings.crf
        });

        // Strategy: WebCodecs (lowest latency) > MSE > Simple video.src
        let started = false;

        // 1. Try WebCodecs + Canvas (Chrome/Edge, ~60ms latency)
        if (!started && 'VideoDecoder' in window && typeof MP4Box !== 'undefined') {
            try {
                await this.startWebCodecsStream(canvas, params);
                canvas.style.display = 'block';
                placeholder.style.display = 'none';
                started = true;
                console.log('Using WebCodecs stream (lowest latency)');
            } catch (e) {
                console.warn('WebCodecs stream failed, falling back:', e);
            }
        }

        // 2. Try MSE + Video element (~126ms latency)
        if (!started && window.MediaSource) {
            try {
                await this.startMSEStream(video, params);
                video.style.display = 'block';
                placeholder.style.display = 'none';
                started = true;
                console.log('Using MSE stream');
            } catch (e) {
                console.warn('MSE stream failed, falling back:', e);
            }
        }

        // 3. Fallback to simple video.src
        if (!started) {
            try {
                this.startSimpleStream(video, params);
                video.style.display = 'block';
                placeholder.style.display = 'none';
                started = true;
            } catch (e2) {
                console.error('All stream methods failed:', e2);
                this.updateModeIndicator('none');
            }
        }

        toggleBtn.classList.remove('btn-loading');
        toggleBtn.disabled = false;
        if (started) {
            toggleBtn.textContent = '⏹ 停止';
            toggleBtn.classList.remove('btn-primary');
            toggleBtn.classList.add('btn-danger');
            this.streamActive = true;
            this.connectInputSocket();
        } else {
            toggleBtn.textContent = '▶ 开始';
            toggleBtn.classList.remove('btn-danger');
            toggleBtn.classList.add('btn-primary');
        }
    }

    // 切换流的开始/停止
    toggleStream() {
        if (this.streamActive) {
            this.stopStream();
        } else {
            this.startStream();
        }
    }

    // Simple direct video.src streaming
    startSimpleStream(video, params) {
        const streamUrl = `/api/stream?${params.toString()}`;
        console.log('Starting simple stream:', streamUrl);

        video.preload = 'none';
        video.muted = true;
        video.playsInline = true;
        video.src = streamUrl;

        video.onloadedmetadata = () => {
            console.log('Video metadata loaded');
            video.play().then(() => {
                this.updateModeIndicator('h264');
                console.log('Video playing');
                this.startStatsTicker();
                const tick = () => {
                    if (!this.streamActive) return;
                    this.streamStatsFrameCount++;
                    if (typeof video.requestVideoFrameCallback === 'function') {
                        video.requestVideoFrameCallback(tick);
                    }
                };
                if (typeof video.requestVideoFrameCallback === 'function') {
                    video.requestVideoFrameCallback(tick);
                }
            }).catch(e => console.error('Play failed:', e));
        };

        video.onerror = (e) => {
            console.error('Video error:', e, video.error);
            this.updateModeIndicator('none');
        };
    }

    startLegacyStream() {
        const img = document.getElementById('stream-img');
        const video = document.getElementById('stream-video');
        const placeholder = document.getElementById('stream-placeholder');

        img.src = `/api/stream/legacy?t=${Date.now()}&access_token=${this.token}`;
        video.style.display = 'none';
        img.style.display = 'block';
        placeholder.style.display = 'none';
    }

    stopStream() {
        if (!this.streamActive) return;

        const canvas = document.getElementById('stream-canvas');
        const video = document.getElementById('stream-video');
        const img = document.getElementById('stream-img');
        const placeholder = document.getElementById('stream-placeholder');
        const toggleBtn = document.getElementById('stream-toggle-btn');

        // Mark as not active first to stop read loop
        this.streamActive = false;
        this.disconnectInputSocket();

        // Clear live edge interval
        if (this.liveEdgeInterval) {
            clearInterval(this.liveEdgeInterval);
            this.liveEdgeInterval = null;
        }
        this.stopStatsTicker();

        // Cancel stream reader
        if (this.streamReader) {
            this.streamReader.cancel().catch(() => { });
            this.streamReader = null;
        }

        // Close WebCodecs VideoDecoder
        if (this.videoDecoder) {
            try {
                this.videoDecoder.close();
            } catch (e) { /* ignore */ }
            this.videoDecoder = null;
        }

        // Close mp4box file
        if (this.mp4boxFile) {
            try {
                this.mp4boxFile.flush();
            } catch (e) { /* ignore */ }
            this.mp4boxFile = null;
        }

        // Close MediaSource (MSE path)
        if (this.mediaSource && this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch (e) {
                // Ignore errors
            }
        }
        this.mediaSource = null;
        this.sourceBuffer = null;

        // Stop video playback and force source removal
        if (video.src) {
            video.pause();
            URL.revokeObjectURL(video.src);
            video.src = '';
            video.load(); // Force browser to stop buffering
        }

        // Clear canvas
        if (canvas.getContext) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Stop image stream
        if (img.src) {
            img.src = '';
        }

        canvas.style.display = 'none';
        video.style.display = 'none';
        img.style.display = 'none';
        placeholder.style.display = 'block';
        toggleBtn.disabled = false;
        toggleBtn.classList.remove('btn-danger', 'btn-loading');
        toggleBtn.classList.add('btn-primary');
        toggleBtn.textContent = '▶ 开始';

        this.updateModeIndicator('none');

        // Log stream stopped
        console.log('Stream stopped');
    }

    /** 建立远程键鼠 WebSocket，仅在 streamActive 时有效 */
    connectInputSocket() {
        this.disconnectInputSocket();
        if (!this.token) return;
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${location.host}/ws/input?access_token=${encodeURIComponent(this.token)}`;
        try {
            const ws = new WebSocket(url);
            ws.onopen = () => console.log('Input WS connected');
            ws.onclose = () => { this.inputSocket = null; };
            ws.onerror = () => { this.inputSocket = null; };
            this.inputSocket = ws;
        } catch (e) {
            console.warn('Input WS connect failed:', e);
        }
    }

    /** 断开远程键鼠 WebSocket */
    disconnectInputSocket() {
        if (this.inputSocket) {
            try {
                this.inputSocket.close();
            } catch (e) { /* ignore */ }
            this.inputSocket = null;
        }
    }

    /** 通过 WebSocket 发送键鼠命令（若未连接则静默忽略） */
    sendInput(type, payload = {}) {
        if (this.inputSocket && this.inputSocket.readyState === WebSocket.OPEN) {
            try {
                this.inputSocket.send(JSON.stringify({ type, ...payload }));
            } catch (e) {
                console.warn('Input WS send failed:', e);
            }
        }
    }

    // MSE-based low-latency streaming for Chrome
    // WebCodecs low-latency streaming: fetch fMP4 -> mp4box.js demux -> VideoDecoder -> Canvas
    async startWebCodecsStream(canvas, params) {
        const streamUrl = `/api/stream?${params.toString()}`;
        console.log('Starting WebCodecs stream:', streamUrl);

        const ctx = canvas.getContext('2d');

        // Create VideoDecoder
        const decoder = new VideoDecoder({
            output: (frame) => {
                this.streamStatsFrameCount++;
                // Resize canvas to match video dimensions (only when changed)
                if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
                    canvas.width = frame.displayWidth;
                    canvas.height = frame.displayHeight;
                    console.log(`WebCodecs: video size ${frame.displayWidth}x${frame.displayHeight}`);
                }
                ctx.drawImage(frame, 0, 0);
                frame.close(); // Must close to release GPU memory
            },
            error: (e) => {
                console.error('VideoDecoder error:', e);
            }
        });
        this.videoDecoder = decoder;

        // Create mp4box file parser
        const mp4boxFile = MP4Box.createFile();
        this.mp4boxFile = mp4boxFile;
        let trackId = null;

        // Called when mp4box has parsed the init segment (moov)
        mp4boxFile.onReady = (info) => {
            console.log('mp4box onReady:', info);

            const videoTrack = info.videoTracks[0];
            if (!videoTrack) {
                console.error('No video track found');
                return;
            }
            trackId = videoTrack.id;

            // Extract AVC decoder config from the track's avcC box
            const trak = mp4boxFile.getTrackById(trackId);
            const avcC = trak.mdia.minf.stbl.stsd.entries[0].avcC;

            // Build codec string from avcC
            const profile = avcC.AVCProfileIndication;
            const compat = avcC.profile_compatibility;
            const level = avcC.AVCLevelIndication;
            const codecStr = `avc1.${profile.toString(16).padStart(2, '0')}${compat.toString(16).padStart(2, '0')}${level.toString(16).padStart(2, '0')}`;

            // Serialize avcC box to ArrayBuffer for the description parameter
            const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
            avcC.write(stream);
            const description = new Uint8Array(stream.buffer, 8); // skip box header (size + type)

            console.log(`WebCodecs: configuring decoder codec=${codecStr}, ${videoTrack.video.width}x${videoTrack.video.height}`);

            decoder.configure({
                codec: codecStr,
                codedWidth: videoTrack.video.width,
                codedHeight: videoTrack.video.height,
                description: description,
                optimizeForLatency: true, // Key: minimize internal buffering
            });

            // Start extracting samples from this track
            mp4boxFile.setExtractionOptions(trackId, null, { nbSamples: 1 });
            mp4boxFile.start();
        };

        // Called when mp4box has extracted encoded samples
        mp4boxFile.onSamples = (id, user, samples) => {
            for (const sample of samples) {
                if (decoder.state === 'closed') return;

                const chunk = new EncodedVideoChunk({
                    type: sample.is_sync ? 'key' : 'delta',
                    timestamp: sample.cts * 1_000_000 / sample.timescale, // to microseconds
                    duration: sample.duration * 1_000_000 / sample.timescale,
                    data: sample.data,
                });

                try {
                    decoder.decode(chunk);
                } catch (e) {
                    console.warn('WebCodecs decode error:', e);
                }
            }
        };

        mp4boxFile.onError = (e) => {
            console.error('mp4box error:', e);
        };

        // Fetch the stream and feed to mp4box
        const response = await fetch(streamUrl, {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        if (!response.ok) {
            throw new Error(`Stream failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        this.streamReader = reader;
        let offset = 0;

        this.streamActive = true;
        this.updateModeIndicator('h264');

        const readStream = async () => {
            try {
                while (this.streamActive) {
                    const { done, value } = await reader.read();
                    if (done) {
                        console.log('WebCodecs stream ended');
                        break;
                    }

                    // mp4box requires ArrayBuffer with fileStart property
                    const buf = value.buffer;
                    buf.fileStart = offset;
                    offset += value.byteLength;
                    this.streamStatsBytes += value.byteLength;

                    mp4boxFile.appendBuffer(buf);
                }
            } catch (e) {
                if (this.streamActive) {
                    console.error('WebCodecs stream read error:', e);
                }
            }
        };

        this.startStatsTicker();
        readStream();
        console.log('WebCodecs stream started');
    }

    // MSE-based low-latency streaming (fallback for browsers without WebCodecs)
    async startMSEStream(video, params) {
        const streamUrl = `/api/stream?${params.toString()}`;
        console.log('Starting MSE stream:', streamUrl);

        // Check MSE support
        if (!window.MediaSource || !MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"')) {
            throw new Error('MSE with H.264 not supported');
        }

        // Create MediaSource
        const mediaSource = new MediaSource();
        this.mediaSource = mediaSource;
        video.src = URL.createObjectURL(mediaSource);

        await new Promise((resolve, reject) => {
            mediaSource.addEventListener('sourceopen', resolve, { once: true });
            mediaSource.addEventListener('error', reject, { once: true });
        });

        // Add source buffer for H.264
        const mimeType = 'video/mp4; codecs="avc1.42E01E"';
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        sourceBuffer.mode = 'sequence'; // Important for live streaming
        this.sourceBuffer = sourceBuffer;

        // Configure video for ultra-low latency
        video.muted = true;
        video.playsInline = true;
        if ('latencyHint' in video) {
            video.latencyHint = 0; // 提示浏览器以最低延迟模式解码
        }

        // Fetch stream with ReadableStream API
        const response = await fetch(streamUrl, {
            headers: { 'Authorization': `Bearer ${this.token}` }
        });

        if (!response.ok) {
            throw new Error(`Stream failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        this.streamReader = reader;
        let totalBytes = 0;
        let firstChunk = true;

        // Buffer management
        const pendingChunks = [];
        let isAppending = false;

        const appendNextChunk = () => {
            if (isAppending || pendingChunks.length === 0 || sourceBuffer.updating) {
                return;
            }

            isAppending = true;
            const chunk = pendingChunks.shift();

            try {
                sourceBuffer.appendBuffer(chunk);
            } catch (e) {
                console.error('Error appending buffer:', e);
                // Try to recover by removing old data
                if (e.name === 'QuotaExceededError' && !sourceBuffer.updating) {
                    const removeEnd = sourceBuffer.buffered.length > 0
                        ? sourceBuffer.buffered.start(0) + 10
                        : 0;
                    if (removeEnd > 0) {
                        sourceBuffer.remove(0, removeEnd);
                    }
                }
            }
        };

        sourceBuffer.addEventListener('updateend', () => {
            isAppending = false;

            // 低延迟缓冲管理
            if (sourceBuffer.buffered.length > 0 && !sourceBuffer.updating) {
                const bufferedEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
                const bufferedStart = sourceBuffer.buffered.start(0);
                const bufferLength = bufferedEnd - bufferedStart;

                // 缓冲超过 1.5 秒时清理旧数据
                if (bufferLength > 1.5) {
                    const removeEnd = bufferedEnd - 0.5;
                    if (removeEnd > bufferedStart) {
                        try {
                            sourceBuffer.remove(bufferedStart, removeEnd);
                        } catch (e) {
                            // Ignore removal errors
                        }
                        return; // Don't append while removing
                    }
                }

                // 落后超过 150ms 就立即追赶到最新帧（降低延迟的关键）
                if (!video.paused && video.currentTime < bufferedEnd - 0.15) {
                    video.currentTime = bufferedEnd - 0.01;
                }
            }

            appendNextChunk();
        });

        // Read stream
        const readStream = async () => {
            try {
                while (this.streamActive) {
                    const { done, value } = await reader.read();

                    if (done) {
                        console.log('Stream ended');
                        break;
                    }

                    totalBytes += value.byteLength;
                    this.streamStatsBytes += value.byteLength;

                    // Queue chunk for appending
                    pendingChunks.push(value);
                    appendNextChunk();

                    // Start playback after first chunk
                    if (firstChunk) {
                        firstChunk = false;
                        console.log('First chunk received, starting playback...');
                        this.updateModeIndicator('h264');

                        // Wait a bit for buffer to build, then play
                        setTimeout(() => {
                            video.play().catch(e => console.error('Play failed:', e));
                            const tick = () => {
                                if (!this.streamActive) return;
                                this.streamStatsFrameCount++;
                                if (typeof video.requestVideoFrameCallback === 'function') {
                                    video.requestVideoFrameCallback(tick);
                                }
                            };
                            if (typeof video.requestVideoFrameCallback === 'function') {
                                video.requestVideoFrameCallback(tick);
                            }
                        }, 100);
                    }
                }
            } catch (e) {
                if (this.streamActive) {
                    console.error('Stream read error:', e);
                }
            }
        };

        this.streamActive = true;
        this.startStatsTicker();
        readStream();

        console.log('MSE stream started');
    }

    updateModeIndicator(mode) {
        const indicator = document.getElementById('stream-mode-indicator');
        if (!indicator) return;

        this.currentStreamMode = mode;

        switch (mode) {
            case 'h264':
                indicator.textContent = '已连接 (H.264)';
                indicator.className = 'mode-indicator active-h264';
                break;
            case 'mjpeg':
                indicator.textContent = '已连接 (MJPEG)';
                indicator.className = 'mode-indicator active-mjpeg';
                break;
            case 'none':
            default:
                indicator.textContent = '未连接';
                indicator.className = 'mode-indicator';
                break;
        }
    }

    /** 更新流统计显示（FPS、缓冲延迟、接收速率） */
    updateStreamStatsDisplay() {
        const el = document.getElementById('stream-stats');
        if (!el || !this.streamActive) {
            if (el) el.classList.remove('visible');
            return;
        }
        const s = this.streamStats;
        const parts = [];
        if (s.fps >= 0) parts.push(`FPS: ${Math.round(s.fps)}`);
        if (s.bufferDelayMs >= 0) parts.push(`缓冲: ${Math.round(s.bufferDelayMs)}ms`);
        if (s.bitrateKbps > 0) parts.push(`${(s.bitrateKbps / 1024).toFixed(2)} Mbps`);
        el.textContent = parts.join(' · ');
        el.classList.add('visible');
    }

    /** 启动流统计定时器：每 500ms 根据帧数/字节数重算 FPS 与码率并刷新显示 */
    startStatsTicker() {
        this.streamStatsFrameCountStart = Date.now();
        this.streamStatsBytesStart = Date.now();
        this.streamStatsFrameCount = 0;
        this.streamStatsBytes = 0;
        this.streamStatsInterval = setInterval(() => {
            if (!this.streamActive) return;
            const now = Date.now();
            const elapsedSec = (now - this.streamStatsFrameCountStart) / 1000;
            const elapsedSecBytes = (now - this.streamStatsBytesStart) / 1000;
            if (elapsedSec >= 0.3) {
                this.streamStats.fps = this.streamStatsFrameCount / elapsedSec;
                this.streamStatsFrameCount = 0;
                this.streamStatsFrameCountStart = now;
            }
            if (elapsedSecBytes >= 0.3 && this.streamStatsBytes > 0) {
                this.streamStats.bitrateKbps = (this.streamStatsBytes * 8 / 1000) / elapsedSecBytes;
                this.streamStatsBytes = 0;
                this.streamStatsBytesStart = now;
            }
            const videoEl = document.getElementById('stream-video');
            if (videoEl && videoEl.buffered.length > 0) {
                const end = videoEl.buffered.end(videoEl.buffered.length - 1);
                this.streamStats.bufferDelayMs = Math.max(0, Math.round((end - videoEl.currentTime) * 1000));
            } else {
                this.streamStats.bufferDelayMs = 0;
            }
            this.updateStreamStatsDisplay();
        }, 500);
    }

    /** 停止流统计定时器并隐藏统计区 */
    stopStatsTicker() {
        if (this.streamStatsInterval) {
            clearInterval(this.streamStatsInterval);
            this.streamStatsInterval = null;
        }
        const el = document.getElementById('stream-stats');
        if (el) {
            el.textContent = '';
            el.classList.remove('visible');
        }
        this.streamStats = { fps: 0, bufferDelayMs: 0, bitrateKbps: 0 };
    }

    /** 左键点击已通过 mouse-down + mouse-up 发送，此处不再绑定 click 事件，避免一次点击在远端变成双击。保留方法以备它用。 */
    handleRemoteClick(e) {
        if (this.isDragging) return;
        if (!this.streamActive) return;

        const element = e.target;
        const rect = element.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        this.sendInput('click', { x, y });
    }

    handleRemoteMouseDown(e) {
        if (!this.streamActive) return;
        // 仅左键走 down/up 序列；中键、右键由 auxclick/contextmenu 单独发送，避免一次操作发送两套
        if (e.button !== 0) return;

        document.getElementById('screenshot-container')?.focus();
        e.preventDefault();
        this.isDragging = true;
        this.dragButton = e.button;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        const element = e.target;
        const rect = element.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        this.sendInput('mouse-down', { x, y, button: e.button });
    }

    handleRemoteMouseMove(e) {
        if (!this.streamActive) return;
        /** 仅当用户点击过视频画面（焦点在流区域）时才实时发送鼠标移动 */
        if (!this.isStreamAreaFocused()) return;

        const now = Date.now();
        if (now - this.lastMoveTime < this.moveThrottleMs) return;
        this.lastMoveTime = now;

        const element = e.target;
        const rect = element.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        this.sendInput('mouse-move', { x, y });
    }

    handleRemoteMouseUp(e) {
        if (!this.streamActive) return;
        if (!this.isDragging) return;

        const element = e.target;
        const rect = element.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        this.sendInput('mouse-up', { x, y, button: this.dragButton });

        const dx = Math.abs(e.clientX - this.dragStartX);
        const dy = Math.abs(e.clientY - this.dragStartY);
        if (dx < 5 && dy < 5) this.isDragging = false;
        setTimeout(() => { this.isDragging = false; }, 10);
    }

    handleRemoteWheel(e) {
        if (!this.streamActive) return;
        e.preventDefault();

        const element = e.target;
        const rect = element.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const delta = e.deltaY > 0 ? -120 : 120;
        this.sendInput('mouse-wheel', { x, y, delta });
    }

    handleRemoteRightClick(e) {
        if (!this.streamActive) return;
        document.getElementById('screenshot-container')?.focus();
        e.preventDefault();

        const rect = e.target.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        this.sendInput('right-click', { x, y });
    }

    handleRemoteMiddleClick(e) {
        if (!this.streamActive) return;
        if (e.button !== 1) return;

        document.getElementById('screenshot-container')?.focus();
        e.preventDefault();
        const rect = e.target.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        this.sendInput('middle-click', { x, y });
    }

    /** 当前焦点是否在视频/流区域（仅此时才将按键发送到远程） */
    isStreamAreaFocused() {
        const container = document.getElementById('screenshot-container');
        if (!container) return false;
        const el = document.activeElement;
        return el === container || container.contains(el);
    }

    handleRemoteKeydown(e) {
        if (!this.streamActive) return;
        if (!this.isStreamAreaFocused()) return;
        if (e.key === 'F11' || (e.key === 'Escape' && this.isFullscreen)) return;

        const vkCode = this.getVirtualKeyCode(e.key, e.code, e.keyCode);
        if (!vkCode) return;
        e.preventDefault();
        this.sendInput('keyboard', { vkCode, isKeyDown: true });
    }

    handleRemoteKeyup(e) {
        if (!this.streamActive) return;
        if (!this.isStreamAreaFocused()) return;

        const vkCode = this.getVirtualKeyCode(e.key, e.code, e.keyCode);
        if (!vkCode) return;
        e.preventDefault();
        this.sendInput('keyboard', { vkCode, isKeyDown: false });
    }

    /**
     * 将 JavaScript key 代码转换为 Windows Virtual Key Code
     * 参考: https://docs.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
     */
    getVirtualKeyCode(key, code, keyCode) {
        // 使用 code 属性（更可靠）
        const vkCodeMap = {
            // 字母和数字
            'KeyA': 0x41, 'KeyB': 0x42, 'KeyC': 0x43, 'KeyD': 0x44, 'KeyE': 0x45, 'KeyF': 0x46,
            'KeyG': 0x47, 'KeyH': 0x48, 'KeyI': 0x49, 'KeyJ': 0x4A, 'KeyK': 0x4B, 'KeyL': 0x4C,
            'KeyM': 0x4D, 'KeyN': 0x4E, 'KeyO': 0x4F, 'KeyP': 0x50, 'KeyQ': 0x51, 'KeyR': 0x52,
            'KeyS': 0x53, 'KeyT': 0x54, 'KeyU': 0x55, 'KeyV': 0x56, 'KeyW': 0x57, 'KeyX': 0x58,
            'KeyY': 0x59, 'KeyZ': 0x5A,

            'Digit0': 0x30, 'Digit1': 0x31, 'Digit2': 0x32, 'Digit3': 0x33, 'Digit4': 0x34,
            'Digit5': 0x35, 'Digit6': 0x36, 'Digit7': 0x37, 'Digit8': 0x38, 'Digit9': 0x39,

            // 功能键
            'Enter': 0x0D, 'Escape': 0x1B, 'Backspace': 0x08, 'Tab': 0x09,
            'Space': 0x20, 'CapsLock': 0x14, 'ShiftLeft': 0xA0, 'ShiftRight': 0xA1,
            'ControlLeft': 0xA2, 'ControlRight': 0xA3, 'AltLeft': 0xA4, 'AltRight': 0xA5,

            // 方向键
            'ArrowLeft': 0x25, 'ArrowUp': 0x26, 'ArrowRight': 0x27, 'ArrowDown': 0x28,

            // 编辑键
            'Insert': 0x2D, 'Delete': 0x2E, 'Home': 0x24, 'End': 0x23, 'PageUp': 0x21, 'PageDown': 0x22,

            // 功能键 F1-F12
            'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73, 'F5': 0x74, 'F6': 0x75,
            'F7': 0x76, 'F8': 0x77, 'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,

            // 特殊键
            'PrintScreen': 0x2C, 'ScrollLock': 0x91, 'Pause': 0x13,
            'NumLock': 0x90,

            // 数字键盘
            'Numpad0': 0x60, 'Numpad1': 0x61, 'Numpad2': 0x62, 'Numpad3': 0x63, 'Numpad4': 0x64,
            'Numpad5': 0x65, 'Numpad6': 0x66, 'Numpad7': 0x67, 'Numpad8': 0x68, 'Numpad9': 0x69,
            'NumpadAdd': 0x6B, 'NumpadSubtract': 0x6D, 'NumpadMultiply': 0x6A, 'NumpadDivide': 0x6F, 'NumpadEnter': 0x0D,

            // 标点符号
            'Semicolon': 0xBA, 'Equal': 0xBB, 'Comma': 0xBC, 'Minus': 0xBD, 'Period': 0xBE, 'Slash': 0xBF,
            'Backquote': 0xC0, 'BracketLeft': 0xDB, 'Backslash': 0xDC, 'BracketRight': 0xDD, 'Quote': 0xDE,
        };

        return vkCodeMap[code] || null;
    }

    // 切换终端连接状态
    toggleTerminal() {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.disconnectTerminal();
        } else {
            this.connectTerminal();
        }
    }

    connectTerminal() {
        if (this.websocket) {
            this.disconnectTerminal();
        }

        const terminalType = document.getElementById('terminal-type').value;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/terminal?access_token=${this.token}&type=${terminalType}`;

        this.websocket = new WebSocket(wsUrl);
        const statusEl = document.getElementById('ws-status');
        const toggleBtn = document.getElementById('terminal-toggle-btn');
        const terminalSelect = document.getElementById('terminal-type');
        const output = document.getElementById('terminal-output');

        this.websocket.onopen = () => {
            statusEl.textContent = `已连接 (${terminalType.toUpperCase()})`;
            statusEl.classList.add('connected');
            toggleBtn.textContent = '断开连接';
            toggleBtn.classList.remove('btn-primary');
            toggleBtn.classList.add('btn-danger');
            terminalSelect.disabled = true;  // 连接时禁用切换
            output.innerHTML = '';
        };

        this.websocket.onmessage = (event) => {
            output.innerHTML += this.escapeHtml(event.data);
            output.scrollTop = output.scrollHeight;
        };

        this.websocket.onclose = () => {
            statusEl.textContent = '未连接';
            statusEl.classList.remove('connected');
            toggleBtn.textContent = '连接终端';
            toggleBtn.classList.remove('btn-danger');
            toggleBtn.classList.add('btn-primary');
            terminalSelect.disabled = false;  // 断开时启用切换
            this.websocket = null;
        };

        this.websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
            output.innerHTML += '\n[连接错误]\n';
        };
    }

    disconnectTerminal() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
    }

    sendCommand() {
        const input = document.getElementById('terminal-input');
        const command = input.value;

        if (this.websocket && this.websocket.readyState === WebSocket.OPEN && command) {
            // 后端会实时返回完整输出（包括命令回显），无需前端手动回显
            this.websocket.send(command);

            // 更新命令历史
            this.commandHistory.push(command);
            this.historyIndex = this.commandHistory.length; // 重置索引到最新

            input.value = '';
        }
    }

    navigateHistory(direction) {
        if (this.commandHistory.length === 0) return;

        if (direction === 'up') {
            if (this.historyIndex > 0) {
                this.historyIndex--;
                document.getElementById('terminal-input').value = this.commandHistory[this.historyIndex];
            }
        } else if (direction === 'down') {
            if (this.historyIndex < this.commandHistory.length - 1) {
                this.historyIndex++;
                document.getElementById('terminal-input').value = this.commandHistory[this.historyIndex];
            } else {
                this.historyIndex = this.commandHistory.length;
                document.getElementById('terminal-input').value = '';
            }
        }
    }

    clearTerminal() {
        document.getElementById('terminal-output').innerHTML = '';
    }

    /**
     * 设置刷新按钮的加载状态（旋转图标并禁用）
     * @param {string|string[]} buttonIds 按钮 id 或 id 数组
     * @param {boolean} refreshing 是否处于加载中
     */
    setRefreshState(buttonIds, refreshing) {
        const ids = Array.isArray(buttonIds) ? buttonIds : [buttonIds];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (refreshing) {
                el.classList.add('refreshing');
                el.disabled = true;
            } else {
                el.classList.remove('refreshing');
                el.disabled = false;
            }
        });
    }

    async loadSystemInfo() {
        this.setRefreshState('refresh-info-btn', true);
        try {
            const response = await fetch('/api/system/info', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const info = await response.json();
                this.renderSystemInfo(info);
            }
        } catch (error) {
            console.error('Failed to load system info:', error);
        } finally {
            this.setRefreshState('refresh-info-btn', false);
        }
    }

    renderSystemInfo(info) {
        // 基本信息
        document.getElementById('info-machine').textContent = info.machineName;
        document.getElementById('info-user').textContent = info.userName;
        document.getElementById('info-os').textContent = info.osVersion;
        document.getElementById('info-arch').textContent = info.is64Bit ? '64 位' : '32 位';
        document.getElementById('info-uptime').textContent = info.upTime;

        // CPU 信息（紧凑行）
        document.getElementById('info-cpu-name-compact').textContent = info.cpuName || '-';
        document.getElementById('info-cpu-cores-compact').textContent =
            info.cpuCores > 0 ? `${info.cpuCores}C / ${info.cpuLogicalProcessors}T` : '-';
        document.getElementById('info-cpu-clock-compact').textContent =
            info.cpuMaxClockSpeedMHz > 0 ? `${(info.cpuMaxClockSpeedMHz / 1000).toFixed(2)} GHz` : '-';

        // CPU 温度
        const cpuTempCompact = document.getElementById('info-cpu-temp-compact');
        if (info.cpuTemperature > 0) {
            const tempClass = info.cpuTemperature > 85 ? 'temp-hot' : info.cpuTemperature > 65 ? 'temp-warm' : 'temp-normal';
            cpuTempCompact.innerHTML = `<span class="${tempClass}">${info.cpuTemperature}°C</span>`;
        } else {
            cpuTempCompact.textContent = 'N/A';
        }

        // CPU 占用率
        this.updateBar('info-cpu-bar', 'info-cpu-usage', info.cpuUsagePercent);

        // 内存信息
        const totalMemGB = (info.totalMemoryMB / 1024).toFixed(1);
        const usedMemGB = (info.usedMemoryMB / 1024).toFixed(1);
        document.getElementById('info-mem-detail').textContent = `${usedMemGB} GB / ${totalMemGB} GB`;
        this.updateBar('info-mem-bar', 'info-mem-usage', info.memoryUsagePercent);

        // GPU 信息
        const gpuListEl = document.getElementById('info-gpu-list');
        if (info.gpus && info.gpus.length > 0) {
            gpuListEl.innerHTML = info.gpus.map(gpu => {
                let details = [];
                if (gpu.memoryMB > 0) {
                    if (gpu.memoryUsedMB > 0) {
                        details.push(`显存: <span class="val">${gpu.memoryUsedMB} MB / ${gpu.memoryMB} MB</span>`);
                    } else {
                        details.push(`显存: <span class="val">${gpu.memoryMB} MB</span>`);
                    }
                }
                if (gpu.usagePercent >= 0) details.push(`占用: <span class="val">${gpu.usagePercent}%</span>`);
                if (gpu.temperature >= 0) {
                    const tc = gpu.temperature > 85 ? 'temp-hot' : gpu.temperature > 65 ? 'temp-warm' : 'temp-normal';
                    details.push(`温度: <span class="val ${tc}">${gpu.temperature}°C</span>`);
                }
                if (gpu.driverVersion) details.push(`驱动: <span class="val">${gpu.driverVersion}</span>`);

                return `<div class="sysinfo-gpu-card">
                    <div class="sysinfo-card-title">${this.escapeHtml(gpu.name)}</div>
                    <div class="sysinfo-card-details">${details.map(d => `<span>${d}</span>`).join('')}</div>
                    ${gpu.memoryMB > 0 && gpu.memoryUsedMB > 0 ? `
                    <div class="sysinfo-bar-container" style="margin-top:8px">
                        <label>显存占用</label>
                        <div class="sysinfo-bar">
                            <div class="sysinfo-bar-fill ${this.getBarClass(Math.round(gpu.memoryUsedMB / gpu.memoryMB * 100))}" style="width:${Math.round(gpu.memoryUsedMB / gpu.memoryMB * 100)}%"></div>
                        </div>
                        <span class="sysinfo-bar-label">${Math.round(gpu.memoryUsedMB / gpu.memoryMB * 100)}%</span>
                    </div>` : ''}
                </div>`;
            }).join('');
        } else {
            gpuListEl.innerHTML = '<span class="text-muted">未检测到显卡</span>';
        }

        // 磁盘信息
        const driveListEl = document.getElementById('info-drive-list');
        if (info.drives && info.drives.length > 0) {
            driveListEl.innerHTML = info.drives.map(drive => `
                <div class="sysinfo-drive-card">
                    <div class="sysinfo-card-title">${this.escapeHtml(drive.name)} <span style="font-weight:400;font-size:12px;color:var(--text-secondary)">${drive.driveFormat}</span></div>
                    <div class="sysinfo-bar-container">
                        <label>${drive.usedGB} / ${drive.totalGB} GB</label>
                        <div class="sysinfo-bar">
                            <div class="sysinfo-bar-fill ${this.getBarClass(drive.usagePercent)}" style="width:${drive.usagePercent}%"></div>
                        </div>
                        <span class="sysinfo-bar-label">${drive.usagePercent}%</span>
                    </div>
                </div>
            `).join('');
        } else {
            driveListEl.innerHTML = '<span class="text-muted">未检测到磁盘</span>';
        }

        // 网络适配器
        const netListEl = document.getElementById('info-network-list');
        if (info.networkAdapters && info.networkAdapters.length > 0) {
            netListEl.innerHTML = info.networkAdapters.map(net => `
                <div class="sysinfo-net-card">
                    <div class="sysinfo-card-title">${this.escapeHtml(net.name)}</div>
                    <div class="sysinfo-card-details">
                        <span>速率: <span class="val">${net.speedMbps >= 1000 ? (net.speedMbps / 1000) + ' Gbps' : net.speedMbps + ' Mbps'}</span></span>
                        ${net.macAddress ? `<span>MAC: <span class="val">${net.macAddress}</span></span>` : ''}
                    </div>
                </div>
            `).join('');
        } else {
            netListEl.innerHTML = '<span class="text-muted">未检测到网络适配器</span>';
        }
    }

    updateBar(barId, labelId, percent) {
        const bar = document.getElementById(barId);
        const label = document.getElementById(labelId);
        if (bar) {
            bar.style.width = `${percent}%`;
            bar.className = `sysinfo-bar-fill ${this.getBarClass(percent)}`;
        }
        if (label) label.textContent = `${percent}%`;
    }

    getBarClass(percent) {
        if (percent >= 90) return 'bar-danger';
        if (percent >= 70) return 'bar-warning';
        return '';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async loadProcesses() {
        this.setRefreshState('refresh-processes-btn', true);
        try {
            const response = await fetch('/api/system/processes', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                this.processes = await response.json();
                this.renderProcesses();
            }
        } catch (error) {
            console.error('Failed to load processes:', error);
        } finally {
            this.setRefreshState('refresh-processes-btn', false);
        }
    }

    renderProcesses() {
        const tbody = document.getElementById('processes-list');
        const countEl = document.getElementById('process-count');

        let filtered = this.processes;

        // 按类型筛选
        if (this.processFilter === 'windowed') {
            filtered = filtered.filter(p => p.hasWindow);
        } else if (this.processFilter === 'background') {
            filtered = filtered.filter(p => !p.hasWindow);
        }

        // 按关键词搜索（匹配名称、窗口标题、描述、PID）
        if (this.processSearchTerm) {
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(this.processSearchTerm) ||
                p.id.toString().includes(this.processSearchTerm) ||
                (p.windowTitle || '').toLowerCase().includes(this.processSearchTerm) ||
                (p.description || '').toLowerCase().includes(this.processSearchTerm)
            );
        }

        // 排序
        if (this.processSortColumn) {
            const col = this.processSortColumn;
            const dir = this.processSortAsc ? 1 : -1;
            filtered = [...filtered].sort((a, b) => {
                let va, vb;
                switch (col) {
                    case 'type':
                        // 应用(hasWindow=true)排前 = 降序时应用在前
                        return ((a.hasWindow ? 1 : 0) - (b.hasWindow ? 1 : 0)) * dir;
                    case 'name':
                        va = (a.description || a.name).toLowerCase();
                        vb = (b.description || b.name).toLowerCase();
                        return va < vb ? -dir : va > vb ? dir : 0;
                    case 'pid':
                        return (a.id - b.id) * dir;
                    case 'cpu':
                        return (a.cpuPercent - b.cpuPercent) * dir;
                    case 'memory':
                        return (a.memoryMB - b.memoryMB) * dir;
                    default:
                        return 0;
                }
            });
        }

        const windowedCount = this.processes.filter(p => p.hasWindow).length;
        const bgCount = this.processes.length - windowedCount;

        tbody.innerHTML = filtered.map(proc => {
            // 显示名称：优先使用描述，否则用进程名
            const displayName = proc.description || proc.name;
            const typeClass = proc.hasWindow ? 'process-type-app' : 'process-type-bg';
            const typeLabel = proc.hasWindow ? '应用' : '后台';
            const titleText = proc.windowTitle
                ? this.escapeHtml(proc.windowTitle)
                : '<span class="text-muted">—</span>';
            const cpu = proc.cpuPercent || 0;
            const cpuClass = cpu > 50 ? 'cpu-high' : cpu > 10 ? 'cpu-mid' : '';

            return `
            <tr class="${proc.hasWindow ? 'process-row-app' : 'process-row-bg'}">
                <td>
                    <span class="process-type-badge ${typeClass}">${typeLabel}</span>
                </td>
                <td class="process-name-cell">
                    <div class="process-name-main">${this.escapeHtml(displayName)}</div>
                    ${proc.description && proc.description !== proc.name
                    ? `<div class="process-name-sub">${this.escapeHtml(proc.name)}</div>`
                    : ''}
                </td>
                <td class="process-title-cell">${titleText}</td>
                <td class="process-pid">${proc.id}</td>
                <td class="process-cpu ${cpuClass}">${cpu.toFixed(1)}%</td>
                <td>${proc.memoryMB.toFixed(1)}</td>
                <td>
                    <button class="btn-kill" onclick="app.killProcess(${proc.id}, '${this.escapeHtml(displayName).replace(/'/g, "\\'")}')">终止</button>
                </td>
            </tr>`;
        }).join('');

        const filterLabel = this.processFilter === 'windowed' ? ' (应用)' :
            this.processFilter === 'background' ? ' (后台)' : '';
        countEl.textContent = `显示 ${filtered.length} 个进程${filterLabel}` +
            (this.processSearchTerm ? ` (搜索中)` : ` · 应用 ${windowedCount} · 后台 ${bgCount} · 总计 ${this.processes.length}`);
    }

    updateSortArrows() {
        document.querySelectorAll('.processes-table th.sortable').forEach(th => {
            const arrow = th.querySelector('.sort-arrow');
            if (!arrow) return;
            arrow.className = 'sort-arrow';
            if (th.dataset.sort === this.processSortColumn) {
                arrow.classList.add(this.processSortAsc ? 'sort-asc' : 'sort-desc');
                th.classList.add('sorted');
            } else {
                th.classList.remove('sorted');
            }
        });
    }

    async killProcess(pid, name) {
        const confirmed = await this.showDialog(
            `确定要终止进程 "${name}" (PID: ${pid}) 吗？`,
            '确认终止进程',
            { type: 'confirm' }
        );

        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch(`/api/system/kill/${pid}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            const data = await response.json();

            if (response.ok) {
                this.loadProcesses();
            } else {
                this.showDialog(data.message || '终止进程失败', '错误');
            }
        } catch (error) {
            this.showDialog('操作失败: ' + error.message, '错误');
        }
    }

    // ============ Docker Management Methods ============

    async loadDockerInfo() {
        this.setRefreshState('refresh-docker-info-btn', true);
        try {
            const response = await fetch('/api/docker/info', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const info = await response.json();
                document.getElementById('docker-containers-total').textContent = info.containers;
                document.getElementById('docker-containers-running').textContent = info.containersRunning;
                document.getElementById('docker-containers-paused').textContent = info.containersPaused;
                document.getElementById('docker-containers-stopped').textContent = info.containersStopped;
                document.getElementById('docker-images-total').textContent = info.images;
                document.getElementById('docker-version').textContent = info.serverVersion;
            }
        } catch (error) {
            console.error('Failed to load docker info:', error);
        } finally {
            this.setRefreshState('refresh-docker-info-btn', false);
        }
    }

    async loadDockerContainers() {
        this.setRefreshState('refresh-containers-btn', true);
        try {
            const response = await fetch('/api/docker/containers', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const result = await response.json();
                this.containers = result.data || [];
                this.renderDockerContainers();
                this.loadDockerContainerStats();
            }
        } catch (error) {
            console.error('Failed to load containers:', error);
        } finally {
            this.setRefreshState('refresh-containers-btn', false);
        }
    }

    async loadDockerContainerStats() {
        try {
            const response = await fetch('/api/docker/containers/stats', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const result = await response.json();
                const statsList = result.data || [];
                this.containerStats = statsList;
                this.renderDockerContainers();
                this.updateContainerStats(statsList);
            }
        } catch (error) {
            console.error('Failed to load container stats:', error);
        }
    }

    /** 更新容器表头排序箭头 */
    updateContainerSortArrows() {
        document.querySelectorAll('.containers-table th.sortable').forEach(th => {
            const arrow = th.querySelector('.sort-arrow');
            if (!arrow) return;
            arrow.className = 'sort-arrow';
            if (th.dataset.sort === this.containerSortColumn) {
                arrow.classList.add(this.containerSortAsc ? 'sort-asc' : 'sort-desc');
                th.classList.add('sorted');
            } else {
                th.classList.remove('sorted');
            }
        });
    }

    updateContainerStats(statsList) {
        // 建立 name -> stats 和 id -> stats 映射
        const statsMap = new Map();
        for (const s of statsList) {
            if (s.id) statsMap.set(s.id, s);
            if (s.name) statsMap.set(s.name, s);
        }

        // 更新表格中每行的 CPU/内存单元格
        const rows = document.querySelectorAll('#containers-list tr[data-container-id]');
        rows.forEach(row => {
            const containerId = row.dataset.containerId;
            const containerName = row.dataset.containerName;
            const cpuCell = row.querySelector('.stats-cpu');
            const memCell = row.querySelector('.stats-mem');

            // 通过 ID 前缀或名称匹配
            let stats = null;
            if (containerId) {
                // docker stats 返回的 ID 可能是短 ID
                for (const [key, value] of statsMap) {
                    if (containerId.startsWith(key) || key.startsWith(containerId.substring(0, 12))) {
                        stats = value;
                        break;
                    }
                }
            }
            if (!stats && containerName) {
                stats = statsMap.get(containerName);
            }

            if (stats) {
                if (cpuCell) {
                    const cpuVal = parseFloat(stats.cpuPercent) || 0;
                    const cpuClass = cpuVal > 80 ? 'stats-high' : cpuVal > 50 ? 'stats-mid' : '';
                    cpuCell.innerHTML = `<span class="stats-value ${cpuClass}">${this.escapeHtml(stats.cpuPercent)}</span>`;
                }
                if (memCell) {
                    const memVal = parseFloat(stats.memPercent) || 0;
                    const memClass = memVal > 80 ? 'stats-high' : memVal > 50 ? 'stats-mid' : '';
                    const memDisplay = (stats.memUsage || '').includes(' / ') ? (stats.memUsage || '').split(' / ')[0].trim() : (stats.memUsage || '');
                    memCell.innerHTML = `<span class="stats-value ${memClass}" title="${this.escapeHtml(memDisplay)}">${this.escapeHtml(memDisplay)}</span>`;
                }
            }
        });
    }

    renderDockerContainers() {
        const tbody = document.getElementById('containers-list');
        if (!tbody) return;
        const searchTerm = (document.getElementById('container-search')?.value || '').toLowerCase();

        let filtered = this.containers.filter(c =>
            (c.names || '').toLowerCase().includes(searchTerm) ||
            (c.image || '').toLowerCase().includes(searchTerm)
        );

        const statsMap = new Map();
        for (const s of this.containerStats) {
            if (s.id) statsMap.set(s.id, s);
            if (s.name) statsMap.set(s.name, s);
        }
        const getStats = (c) => {
            if (!statsMap.size) return null;
            let st = statsMap.get(c.id) || statsMap.get(c.names);
            if (!st && c.id) {
                for (const [key, value] of statsMap) {
                    if (c.id.startsWith(key) || (key && key.startsWith(c.id.substring(0, 12)))) return value;
                }
            }
            return st;
        };

        if (this.containerSortColumn) {
            const col = this.containerSortColumn;
            const dir = this.containerSortAsc ? 1 : -1;
            filtered = [...filtered].sort((a, b) => {
                let cmp = 0;
                switch (col) {
                    case 'name':
                        cmp = (a.names || '').localeCompare(b.names || '');
                        break;
                    case 'image':
                        cmp = (a.image || '').localeCompare(b.image || '');
                        break;
                    case 'state':
                        cmp = (a.state || '').localeCompare(b.state || '');
                        break;
                    case 'ports':
                        cmp = (a.ports || '').localeCompare(b.ports || '');
                        break;
                    case 'cpu': {
                        const sa = getStats(a), sb = getStats(b);
                        const va = sa ? parseFloat(sa.cpuPercent) || 0 : 0;
                        const vb = sb ? parseFloat(sb.cpuPercent) || 0 : 0;
                        cmp = va - vb;
                        break;
                    }
                    case 'memory': {
                        const sa = getStats(a), sb = getStats(b);
                        const va = sa ? parseFloat(sa.memPercent) || 0 : 0;
                        const vb = sb ? parseFloat(sb.memPercent) || 0 : 0;
                        cmp = va - vb;
                        break;
                    }
                    default:
                        return 0;
                }
                return cmp * dir;
            });
        }

        tbody.innerHTML = filtered.map(container => `
            <tr data-container-id="${this.escapeHtml(container.id)}" data-container-name="${this.escapeHtml(container.names)}">
                <td>${this.escapeHtml(container.names)}</td>
                <td>${this.escapeHtml(container.image)}</td>
                <td><span class="status-badge ${container.state === 'running' ? 'running' : 'stopped'}">${this.escapeHtml(container.state)}</span></td>
                <td class="stats-cpu stats-column">${container.state === 'running' ? '<span class="stats-loading">...</span>' : '<span class="stats-na">-</span>'}</td>
                <td class="stats-mem stats-column">${container.state === 'running' ? '<span class="stats-loading">...</span>' : '<span class="stats-na">-</span>'}</td>
                <td class="ports-column">${this.escapeHtml(container.ports)}</td>
                <td>
                    ${container.state === 'running'
                ? `<button class="btn-small" onclick="app.stopDockerContainer('${container.id}')">停止</button>`
                : `<button class="btn-small" onclick="app.startDockerContainer('${container.id}')">启动</button>`
            }
                    <button class="btn-small danger" onclick="app.removeDockerContainer('${container.id}')">删除</button>
                    <button class="btn-small" onclick="app.viewDockerLogs('${container.id}')">日志</button>
                </td>
            </tr>
        `).join('');
    }

    async startDockerContainer(containerId) {
        try {
            const response = await fetch(`/api/docker/containers/${containerId}/start`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                this.showDialog('容器已启动', '成功');
                this.loadDockerContainers();
            } else {
                const data = await response.json();
                this.showDialog(data.message, '错误');
            }
        } catch (error) {
            this.showDialog('操作失败: ' + error.message, '错误');
        }
    }

    async stopDockerContainer(containerId) {
        try {
            const response = await fetch(`/api/docker/containers/${containerId}/stop`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                this.showDialog('容器已停止', '成功');
                this.loadDockerContainers();
            } else {
                const data = await response.json();
                this.showDialog(data.message, '错误');
            }
        } catch (error) {
            this.showDialog('操作失败: ' + error.message, '错误');
        }
    }

    async removeDockerContainer(containerId) {
        const confirmed = await this.showDialog(
            '确定要删除此容器吗？',
            '确认删除',
            { type: 'confirm' }
        );

        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch(`/api/docker/containers/${containerId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                this.showDialog('容器已删除', '成功');
                this.loadDockerContainers();
            } else {
                const data = await response.json();
                this.showDialog(data.message, '错误');
            }
        } catch (error) {
            this.showDialog('操作失败: ' + error.message, '错误');
        }
    }

    async viewDockerLogs(containerId) {
        try {
            const response = await fetch(`/api/docker/containers/${containerId}/logs?lines=50`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const result = await response.json();
                this.showDialog('容器日志（最近50行）：', '日志查看', { logs: result.logs });
            }
        } catch (error) {
            this.showDialog('获取日志失败: ' + error.message, '错误');
        }
    }

    async loadDockerImages() {
        this.setRefreshState('refresh-images-btn', true);
        try {
            const response = await fetch('/api/docker/images', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const result = await response.json();
                this.renderDockerImages(result.data);
            }
        } catch (error) {
            console.error('Failed to load images:', error);
        } finally {
            this.setRefreshState('refresh-images-btn', false);
        }
    }

    renderDockerImages(images) {
        const tbody = document.getElementById('images-list');

        tbody.innerHTML = images.map(image => `
            <tr>
                <td>${this.escapeHtml(image.repository)}</td>
                <td>${this.escapeHtml(image.tag)}</td>
                <td>${this.escapeHtml(image.size)}</td>
                <td>${this.escapeHtml(image.created)}</td>
                <td>
                    <button class="btn-small" onclick="app.checkImageUpdate('${image.repository}:${image.tag}')">检查更新</button>
                </td>
            </tr>
        `).join('');
    }

    async pullDockerImage() {
        const imageTag = document.getElementById('pull-image-input').value.trim();
        if (!imageTag) {
            this.showDialog('请输入镜像标签', '提示');
            return;
        }

        try {
            const response = await fetch('/api/docker/images/pull', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ imageTag })
            });

            if (response.ok) {
                this.showDialog('镜像拉取中，请稍候...', '提示');
                document.getElementById('pull-image-input').value = '';
                setTimeout(() => this.loadDockerImages(), 2000);
            } else {
                const data = await response.json();
                this.showDialog(data.message, '错误');
            }
        } catch (error) {
            this.showDialog('拉取失败: ' + error.message, '错误');
        }
    }

    async checkImageUpdate(imageTag) {
        try {
            const response = await fetch('/api/docker/images/check-update', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ imageTag })
            });

            if (response.ok) {
                const result = await response.json();
                this.showDialog(result.hasUpdate ? '有新版本可用' : '已是最新版本', '检查结果');
            }
        } catch (error) {
            this.showDialog('检查失败: ' + error.message, '错误');
        }
    }

    async composeUp() {
        const path = document.getElementById('compose-path-input').value.trim();
        if (!path) {
            this.showDialog('请输入 docker-compose.yml 路径', '提示');
            return;
        }

        try {
            const response = await fetch('/api/docker/compose/up', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ composePath: path })
            });

            const data = await response.json();
            this.showDialog(data.message, response.ok ? '成功' : '错误');
            if (response.ok) {
                setTimeout(() => this.loadDockerContainers(), 1000);
            }
        } catch (error) {
            this.showDialog('操作失败: ' + error.message, '错误');
        }
    }

    async composeDown() {
        const path = document.getElementById('compose-path-input').value.trim();
        if (!path) {
            this.showDialog('请输入 docker-compose.yml 路径', '提示');
            return;
        }

        try {
            const response = await fetch('/api/docker/compose/down', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ composePath: path })
            });

            const data = await response.json();
            this.showDialog(data.message, response.ok ? '成功' : '错误');
            if (response.ok) {
                setTimeout(() => this.loadDockerContainers(), 1000);
            }
        } catch (error) {
            this.showDialog('操作失败: ' + error.message, '错误');
        }
    }

    // ============ Docker Compose Editor Methods ============

    async loadComposeFile() {
        const filePath = document.getElementById('compose-file-path-input').value.trim();
        if (!filePath) {
            this.showDialog('请输入 compose 文件路径', '提示');
            return;
        }

        try {
            const response = await fetch(`/api/docker/compose/read?path=${encodeURIComponent(filePath)}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const result = await response.json();
                document.getElementById('compose-editor-content').value = result.content;
                //this.showDialog('文件加载成功', '成功');
                // 保存到本地历史
                this.addComposeToHistory(filePath);
            } else {
                const data = await response.json();
                this.showDialog(data.message || '文件加载失败', '错误');
            }
        } catch (error) {
            this.showDialog('加载失败: ' + error.message, '错误');
        }
    }

    newComposeFile() {
        const template = `# Docker Compose 示例 - 可根据需要修改或删除
# 文档: https://docs.docker.com/compose/compose-file/

version: '3.8'

services:
  # 服务名（可自定义），下方缩进使用 2 个空格
  web:
    image: nginx:latest          # 使用官方镜像，或改为 build: . 从 Dockerfile 构建
    container_name: my-web       # 可选：指定容器名称
    ports:
      - "8080:80"                # 宿主机端口:容器端口
    volumes:
      - ./html:/usr/share/nginx/html   # 宿主机路径:容器内路径
    environment:
      - TZ=Asia/Shanghai         # 环境变量，键=值
    restart: unless-stopped      # 重启策略：no / always / on-failure / unless-stopped

  # 第二个服务示例：依赖 web 启动后再启动
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data         # 命名卷，需在下方 volumes 中声明
    depends_on:
      - web                     # 先启动 web 再启动本服务
    restart: unless-stopped

# 命名卷声明（上面 services 中引用的卷需在此列出）
volumes:
  redis-data:
`;
        document.getElementById('compose-editor-content').value = template;
    }

    async saveComposeFile() {
        const filePath = document.getElementById('compose-file-path-input').value.trim();
        const content = document.getElementById('compose-editor-content').value;

        if (!filePath) {
            this.showDialog('请输入 compose 文件路径', '提示');
            return;
        }

        if (!content.trim()) {
            this.showDialog('请输入 compose 文件内容', '提示');
            return;
        }

        try {
            const response = await fetch('/api/docker/compose/write', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path: filePath, content })
            });

            const data = await response.json();
            if (response.ok) {
                this.showDialog('文件保存成功', '成功');
                this.addComposeToHistory(filePath);
            } else {
                this.showDialog(data.message || '保存失败', '错误');
            }
        } catch (error) {
            this.showDialog('保存失败: ' + error.message, '错误');
        }
    }

    async runComposeUp() {
        const filePath = document.getElementById('compose-file-path-input').value.trim();
        const content = document.getElementById('compose-editor-content').value;

        if (!filePath) {
            this.showDialog('请输入 compose 文件路径', '提示');
            return;
        }

        try {
            const saveResponse = await fetch('/api/docker/compose/write', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path: filePath, content })
            });

            if (!saveResponse.ok) {
                this.showDialog('保存文件失败', '错误');
                return;
            }

            this.addComposeToHistory(filePath);
            this.showComposeStreamLog('Compose Up', '/api/docker/compose/up/stream', { composePath: filePath }, () => {
                setTimeout(() => this.loadComposeStatus(), 500);
            });
        } catch (error) {
            this.showDialog('执行失败: ' + error.message, '错误');
        }
    }

    async runComposeDown() {
        const filePath = document.getElementById('compose-file-path-input').value.trim();

        if (!filePath) {
            this.showDialog('请输入 compose 文件路径', '提示');
            return;
        }

        this.showComposeStreamLog('Compose Down', '/api/docker/compose/down/stream', { composePath: filePath }, () => {
            setTimeout(() => this.loadComposeStatus(), 500);
        });
    }

    async validateCompose() {
        const filePath = document.getElementById('compose-file-path-input').value.trim();
        const content = document.getElementById('compose-editor-content').value;

        if (!content.trim()) {
            this.showDialog('请输入 compose 文件内容', '提示');
            return;
        }

        try {
            const response = await fetch('/api/docker/compose/validate', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path: filePath || 'docker-compose.yml', content })
            });

            const data = await response.json();
            if (response.ok) {
                this.showDialog('Compose 文件格式正确', '验证成功');
            } else {
                this.showDialog(data.message || '验证失败', '错误');
            }
        } catch (error) {
            this.showDialog('验证失败: ' + error.message, '错误');
        }
    }

    async loadComposeStatus() {
        this.setRefreshState('refresh-compose-status-btn', true);
        try {
            const response = await fetch('/api/docker/compose/status', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const result = await response.json();
                this.renderComposeStatus(result.data || result.composeServices || []);
            }
        } catch (error) {
            console.error('Failed to load compose status:', error);
        } finally {
            this.setRefreshState('refresh-compose-status-btn', false);
        }
    }

    renderComposeStatus(projects) {
        const container = document.getElementById('compose-status-container');

        if (!projects || projects.length === 0) {
            container.innerHTML = '<p>暂无 Docker Compose 项目</p>';
            return;
        }

        const containersList = (project) => {
            const list = project.containers || [];
            if (list.length === 0) return '<p class="compose-containers-empty">暂无容器信息</p>';
            return `
                <ul class="compose-containers-list">
                    ${list.map(c => `
                        <li class="compose-container-row">
                            <span class="container-name" title="${this.escapeHtml(c.names || '')}">${this.escapeHtml((c.names || '-').length > 30 ? (c.names || '').substring(0, 30) + '…' : (c.names || '-'))}</span>
                            <span class="container-image" title="${this.escapeHtml(c.image || '')}">${this.escapeHtml((c.image || '-').length > 25 ? (c.image || '').substring(0, 25) + '…' : (c.image || '-'))}</span>
                            <span class="container-state state-${(c.state || '').toLowerCase()}">${this.escapeHtml(c.state || c.status || '-')}</span>
                        </li>
                    `).join('')}
                </ul>
            `;
        };

        container.innerHTML = projects.map(project => {
            const configPath = (project.configFiles || '').trim();
            const pathAttr = this.escapeHtml(configPath);
            return `
            <div class="compose-status-item" data-compose-path="${pathAttr}">
                <div class="status-header">
                    <strong>${this.escapeHtml(project.name || 'Unknown')}</strong>
                    <span class="status-badge ${project.status === 'running' ? 'running' : 'stopped'}">
                        ${this.escapeHtml(project.status === 'running' ? '运行中' : project.status || '已停止')}
                    </span>
                </div>
                <div class="status-details">
                    <div class="detail-row">
                        <span class="label">文件:</span>
                        <span class="value" title="${pathAttr}">${pathAttr.length > 45 ? pathAttr.substring(0, 45) + '…' : pathAttr || '-'}</span>
                    </div>
                    <div class="detail-row detail-row-containers">
                        <span class="label">容器 (${(project.containers || []).length}):</span>
                        <div class="compose-containers-wrap">${containersList(project)}</div>
                    </div>
                </div>
                <div class="compose-card-actions">
                    <button type="button" class="btn btn-small btn-secondary compose-card-btn" data-action="compose-edit" title="加载到编辑器">📝 编辑</button>
                    <button type="button" class="btn btn-small btn-secondary compose-card-btn" data-action="compose-pull" title="拉取镜像">⬇️ 拉取</button>
                    <button type="button" class="btn btn-small btn-primary compose-card-btn" data-action="compose-up" title="启动">▶️ 运行</button>
                    <button type="button" class="btn btn-small btn-warning compose-card-btn" data-action="compose-down" title="停止">⏹️ 停止</button>
                </div>
            </div>
        `;
        }).join('');

        // 卡片操作按钮委托（编辑/拉取/运行/停止）
        container.querySelectorAll('.compose-card-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = e.target.closest('.compose-status-item');
                const path = item?.getAttribute('data-compose-path')?.trim();
                if (!path) return;
                const action = e.target.getAttribute('data-action');
                const input = document.getElementById('compose-file-path-input');
                if (input) input.value = path;
                if (action === 'compose-edit') this.loadComposeFile();
                else if (action === 'compose-pull') this.runComposePull();
                else if (action === 'compose-up') this.runComposeUp();
                else if (action === 'compose-down') this.runComposeDown();
            });
        });
    }

    async showComposeLogs() {
        try {
            const response = await fetch('/api/docker/compose/logs', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const result = await response.json();
                this.showDialog('Compose 日志（最近100行）', '日志查看', { logs: result.logs || result.message || '暂无日志' });
            }
        } catch (error) {
            this.showDialog('获取日志失败: ' + error.message, '错误');
        }
    }

    addComposeToHistory(filePath) {
        let history = JSON.parse(localStorage.getItem('composeHistory') || '[]');
        // 移除重复的路径
        history = history.filter(p => p !== filePath);
        // 添加到开头，限制最近10个
        history.unshift(filePath);
        history = history.slice(0, 10);
        localStorage.setItem('composeHistory', JSON.stringify(history));
        this.renderComposeHistory();
    }

    renderComposeHistory() {
        const history = JSON.parse(localStorage.getItem('composeHistory') || '[]');
        const container = document.getElementById('compose-history-list');

        if (history.length === 0) {
            container.innerHTML = '<p>暂无历史记录</p>';
            return;
        }

        container.innerHTML = history.map(path => `
            <div class="history-item">
                <button class="history-button" onclick="app.loadHistoryCompose('${path.replace(/'/g, "\\'")}')">
                    📄 ${this.escapeHtml(path)}
                </button>
            </div>
        `).join('');
    }

    loadHistoryCompose(filePath) {
        document.getElementById('compose-file-path-input').value = filePath;
        this.loadComposeFile();
    }

    // ============ Hash 路由管理 ============

    /**
     * 更新 URL hash，记录当前 tab 和相关路径
     * 格式: #tab=xxx 或 #tab=files&path=xxx 或 #tab=compose&composePath=xxx
     */
    updateHash() {
        const tab = this.currentTab || 'controls';
        const params = new URLSearchParams();
        params.set('tab', tab);

        if (tab === 'files' && this.currentPath) {
            params.set('path', this.currentPath);
        } else if (tab === 'compose') {
            const composeInput = document.getElementById('compose-file-path-input');
            if (composeInput && composeInput.value.trim()) {
                params.set('composePath', composeInput.value.trim());
            }
        }

        const newHash = '#' + params.toString();
        if (window.location.hash !== newHash) {
            history.replaceState(null, '', newHash);
        }
    }

    /**
     * 从 URL hash 恢复状态
     */
    restoreFromHash() {
        const hash = window.location.hash;
        if (!hash || hash.length <= 1) return false;

        try {
            const params = new URLSearchParams(hash.substring(1));
            const tab = params.get('tab');

            if (!tab) return false;

            // 验证 tab 是否有效
            const validTabs = ['controls', 'processes', 'screenshot', 'terminal', 'docker', 'images', 'compose', 'files'];
            if (!validTabs.includes(tab)) return false;

            if (tab === 'files') {
                const path = params.get('path');
                // 先切换到 files tab（不加载默认文件列表）
                this.switchTab('files', true);
                // 加载指定路径
                if (path) {
                    this.loadFiles(path);
                } else {
                    this.loadFiles();
                }
            } else if (tab === 'compose') {
                const composePath = params.get('composePath');
                this.switchTab('compose', true);
                this.loadComposeStatus();
                this.renderComposeHistory();
                if (composePath) {
                    document.getElementById('compose-file-path-input').value = composePath;
                    this.loadComposeFile();
                }
            } else {
                this.switchTab(tab, true);
            }

            // 手动设置 hash（因为 skipHashUpdate=true）
            this.currentTab = tab;
            this.updateHash();

            return true;
        } catch (e) {
            console.error('Failed to restore from hash:', e);
            return false;
        }
    }

    // ============ Docker Compose 文件检测 ============

    /**
     * 判断文件名是否为 docker compose 文件
     */
    isDockerComposeFile(filename) {
        if (!filename) return false;
        const lower = filename.toLowerCase();
        // 常见的 compose 文件名模式
        return lower === 'docker-compose.yml' ||
            lower === 'docker-compose.yaml' ||
            lower === 'compose.yml' ||
            lower === 'compose.yaml' ||
            lower === 'docker-compose.override.yml' ||
            lower === 'docker-compose.override.yaml' ||
            (lower.includes('compose') && (lower.endsWith('.yml') || lower.endsWith('.yaml')));
    }

    /**
     * 从文件管理器打开 compose 管理
     */
    openComposeManager(filePath) {
        // 切换到 compose tab
        this.switchTab('compose');
        // 设置文件路径并加载
        document.getElementById('compose-file-path-input').value = filePath;
        this.loadComposeFile();
    }

    // ============ Compose 文件选择对话框（树形/列表） ============

    /** 打开 Compose 文件选择对话框，复用文件列表 API */
    openComposeFilePicker() {
        const dialog = document.getElementById('compose-file-picker-dialog');
        if (!dialog) return;
        const currentComposePath = document.getElementById('compose-file-path-input')?.value?.trim();
        if (currentComposePath) {
            const normalized = currentComposePath.replace(/\\/g, '/');
            const lastSlash = normalized.lastIndexOf('/');
            this.pickerCurrentPath = lastSlash > 0 ? normalized.substring(0, lastSlash) : null;
        } else {
            this.pickerCurrentPath = null;
        }
        dialog.style.display = 'flex';
        this.loadPickerFiles(this.pickerCurrentPath);
    }

    closeComposeFilePicker() {
        const dialog = document.getElementById('compose-file-picker-dialog');
        if (dialog) dialog.style.display = 'none';
    }

    async loadPickerFiles(path = null) {
        const listEl = document.getElementById('picker-files-list');
        const loadingEl = document.getElementById('picker-loading');
        const emptyEl = document.getElementById('picker-empty');
        if (!listEl || !loadingEl || !emptyEl) return;

        listEl.innerHTML = '';
        emptyEl.style.display = 'none';
        loadingEl.style.display = 'block';
        this.setRefreshState('picker-refresh-btn', true);

        try {
            const url = path ? `/api/files/list?path=${encodeURIComponent(path)}` : '/api/files/list';
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            loadingEl.style.display = 'none';

            if (response.ok) {
                const result = await response.json();
                this.pickerCurrentPath = path || null;
                this.updatePickerBreadcrumb(this.pickerCurrentPath);
                this.renderPickerList(result.data || [], listEl, emptyEl);
            } else {
                emptyEl.textContent = '加载失败';
                emptyEl.style.display = 'block';
            }
        } catch (err) {
            loadingEl.style.display = 'none';
            emptyEl.textContent = '加载失败: ' + (err.message || '');
            emptyEl.style.display = 'block';
        } finally {
            this.setRefreshState('picker-refresh-btn', false);
        }
    }

    renderPickerList(files, listEl, emptyEl) {
        if (!files || files.length === 0) {
            emptyEl.textContent = '暂无文件';
            emptyEl.style.display = 'block';
            return;
        }
        emptyEl.style.display = 'none';

        const rows = files.map(file => {
            const isDir = file.isDirectory;
            const isCompose = !isDir && this.isDockerComposeFile(file.name);
            const icon = isDir ? '📁' : this.getFileIcon(file.name);
            const typeText = isDir ? '文件夹' : (isCompose ? 'Compose' : '文件');
            const dateStr = file.modified ? new Date(file.modified).toLocaleString() : '-';

            return `
                <tr class="picker-row ${isDir ? 'picker-row-folder' : ''}" data-path="${this.escapeHtml(file.path)}" data-name="${this.escapeHtml(file.name)}" data-is-dir="${isDir}">
                    <td class="picker-name-col">${icon} ${this.escapeHtml(file.name)}</td>
                    <td class="picker-type-col">${typeText}</td>
                    <td class="picker-date-col">${dateStr}</td>
                    <td class="picker-action-col">
                        ${isCompose ? '<button type="button" class="btn btn-small btn-primary picker-select-btn">选择</button>' : ''}
                    </td>
                </tr>
            `;
        }).join('');

        listEl.innerHTML = rows;

        listEl.querySelectorAll('.picker-row').forEach(row => {
            const path = row.dataset.path;
            const isDir = row.dataset.isDir === 'true';

            if (isDir) {
                row.addEventListener('click', (e) => {
                    if (!e.target.closest('.picker-select-btn')) {
                        this.loadPickerFiles(path);
                    }
                });
            }

            const selectBtn = row.querySelector('.picker-select-btn');
            if (selectBtn) {
                selectBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.getElementById('compose-file-path-input').value = path;
                    this.closeComposeFilePicker();
                    this.loadComposeFile();
                });
            }
        });
    }

    updatePickerBreadcrumb(path) {
        const container = document.getElementById('picker-breadcrumb');
        if (!container) return;

        container.innerHTML = '';

        const homeBtn = document.createElement('button');
        homeBtn.type = 'button';
        homeBtn.className = 'breadcrumb-item breadcrumb-home';
        homeBtn.textContent = '根';
        homeBtn.addEventListener('click', () => this.pickerNavigateHome());
        container.appendChild(homeBtn);

        if (path && path !== '' && path !== '/') {
            const normalizedPath = path.replace(/\\/g, '/');
            const parts = normalizedPath.split('/').filter(p => p !== '');

            parts.forEach((part, index) => {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.textContent = ' \\ ';
                container.appendChild(sep);

                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'breadcrumb-item';
                if (index === 0 && part.match(/^[A-Za-z]:$/)) {
                    item.textContent = part;
                    item.addEventListener('click', () => this.loadPickerFiles(part + '\\'));
                } else {
                    item.textContent = part;
                    const fullPath = parts.slice(0, index + 1).join('/');
                    item.addEventListener('click', () => this.loadPickerFiles(fullPath));
                }
                container.appendChild(item);
            });
        }
    }

    pickerNavigateHome() {
        this.loadPickerFiles(null);
    }

    pickerNavigateBack() {
        if (!this.pickerCurrentPath) return;
        const normalized = this.pickerCurrentPath.replace(/\\/g, '/');
        if (normalized.match(/^[A-Za-z]:\/$/)) {
            this.loadPickerFiles(null);
            return;
        }
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash > 0) {
            const parent = normalized.substring(0, lastSlash);
            this.loadPickerFiles(parent.match(/^[A-Za-z]:$/) ? parent + '\\' : parent);
        } else {
            this.loadPickerFiles(null);
        }
    }

    // ============ Compose Pull ============

    /**
     * 执行 docker-compose pull（实时日志弹窗）
     */
    async runComposePull() {
        const filePath = document.getElementById('compose-file-path-input').value.trim();

        if (!filePath) {
            this.showDialog('请输入 compose 文件路径', '提示');
            return;
        }

        this.showComposeStreamLog('Compose Pull', '/api/docker/compose/pull/stream', { composePath: filePath });
    }

    // ============ 路径收藏夹 ============

    addBookmark() {
        const path = this.currentPath;
        if (!path) {
            this.showToast('当前在根目录，无需收藏', 'info');
            return;
        }
        let bookmarks = JSON.parse(localStorage.getItem('fileBookmarks') || '[]');
        if (bookmarks.includes(path)) {
            this.showToast('该路径已在收藏夹中', 'info');
            return;
        }
        bookmarks.unshift(path);
        bookmarks = bookmarks.slice(0, 20); // 最多20个
        localStorage.setItem('fileBookmarks', JSON.stringify(bookmarks));
        this.showToast('已收藏当前路径', 'success');
    }

    removeBookmark(path) {
        let bookmarks = JSON.parse(localStorage.getItem('fileBookmarks') || '[]');
        bookmarks = bookmarks.filter(b => b !== path);
        localStorage.setItem('fileBookmarks', JSON.stringify(bookmarks));
        this.renderBookmarkDropdown();
    }

    toggleBookmarkDropdown() {
        const dropdown = document.getElementById('bookmark-dropdown');
        if (dropdown.style.display === 'none') {
            this.renderBookmarkDropdown();
            dropdown.style.display = 'block';
        } else {
            dropdown.style.display = 'none';
        }
    }

    hideBookmarkDropdown() {
        const dropdown = document.getElementById('bookmark-dropdown');
        if (dropdown) dropdown.style.display = 'none';
    }

    hideCreateDropdown() {
        const dropdown = document.getElementById('create-dropdown');
        if (dropdown) dropdown.style.display = 'none';
    }

    renderBookmarkDropdown() {
        const dropdown = document.getElementById('bookmark-dropdown');
        const bookmarks = JSON.parse(localStorage.getItem('fileBookmarks') || '[]');

        if (bookmarks.length === 0) {
            dropdown.innerHTML = '<div class="bookmark-empty">暂无收藏</div>';
            return;
        }

        dropdown.innerHTML = bookmarks.map(path => `
            <div class="bookmark-item">
                <span class="bookmark-path" data-path="${this.escapeHtml(path)}" title="${this.escapeHtml(path)}">
                    📁 ${this.escapeHtml(path.length > 40 ? '...' + path.slice(-37) : path)}
                </span>
                <button class="bookmark-remove" data-path="${this.escapeHtml(path)}" title="移除收藏">✕</button>
            </div>
        `).join('');

        // 绑定点击事件
        dropdown.querySelectorAll('.bookmark-path').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const p = el.dataset.path;
                this.hideBookmarkDropdown();
                this.loadFiles(p);
            });
        });
        dropdown.querySelectorAll('.bookmark-remove').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeBookmark(el.dataset.path);
            });
        });
    }

    // ============ 面包屑可编辑模式 ============

    enterBreadcrumbEditMode() {
        const items = document.getElementById('breadcrumb-items');
        const blank = document.getElementById('breadcrumb-blank');
        const input = document.getElementById('breadcrumb-input');
        if (!items || !input) return;

        items.style.display = 'none';
        blank.style.display = 'none';
        input.style.display = 'block';
        input.value = this.currentPath || '';
        input.focus();
        input.select();
    }

    exitBreadcrumbEditMode() {
        const items = document.getElementById('breadcrumb-items');
        const blank = document.getElementById('breadcrumb-blank');
        const input = document.getElementById('breadcrumb-input');
        if (!items || !input) return;

        input.style.display = 'none';
        items.style.display = 'flex';
        blank.style.display = 'flex';
    }

    navigateFromBreadcrumbInput() {
        const input = document.getElementById('breadcrumb-input');
        const path = input.value.trim();
        this.exitBreadcrumbEditMode();
        if (path) {
            this.loadFiles(path);
        } else {
            this.loadFiles(null);
        }
    }

    // ============ File Management Methods ============

    async loadFiles(path = null) {
        this.setRefreshState(['refresh-files-btn', 'breadcrumb-refresh-btn'], true);
        try {
            const url = path ? `/api/files/list?path=${encodeURIComponent(path)}` : '/api/files/list';
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const result = await response.json();
                this.currentPath = path || null;
                this.files = result.data || [];
                this.renderFilesList();
                this.updateBreadcrumb(path);
                // 更新 hash 以记住文件路径
                this.updateHash();
            }
        } catch (error) {
            console.error('Failed to load files:', error);
        } finally {
            this.setRefreshState(['refresh-files-btn', 'breadcrumb-refresh-btn'], false);
        }
    }

    updateBreadcrumb(path) {
        const container = document.getElementById('breadcrumb-items');
        if (!container) return;
        container.innerHTML = '';

        // 确保退出编辑模式
        this.exitBreadcrumbEditMode();

        // 添加主目录按钮（所有驱动器列表）
        const homeBtn = document.createElement('button');
        homeBtn.className = 'breadcrumb-item breadcrumb-home';
        homeBtn.textContent = '根';
        homeBtn.onclick = () => this.navigateToHome();
        container.appendChild(homeBtn);

        if (path && path !== '' && path !== '/') {
            // Windows 路径处理（如 C:\folder1\folder2 或 C:/folder1/folder2）
            let normalizedPath = path.replace(/\\/g, '/');
            const parts = normalizedPath.split('/').filter(p => p !== '');

            parts.forEach((part, index) => {
                const separator = document.createElement('span');
                separator.className = 'breadcrumb-separator';
                separator.textContent = '\\';
                container.appendChild(separator);

                const item = document.createElement('button');
                item.className = 'breadcrumb-item';

                // 对于驱动器根目录（如 C:），添加反斜杠以形成完整路径
                if (index === 0 && part.match(/^[A-Za-z]:$/)) {
                    item.textContent = part;
                    const drivePath = part + '\\';
                    item.onclick = () => this.navigateToBreadcrumb(drivePath);
                } else {
                    item.textContent = part;
                    // 重建完整路径
                    const currentPath = parts.slice(0, index + 1).join('/');
                    item.onclick = () => this.navigateToBreadcrumb(currentPath);
                }

                container.appendChild(item);
            });
        }
    }

    navigateToHome() {
        // 导航到驱动器列表
        this.loadFiles(null);
    }

    navigateToBreadcrumb(path) {
        this.loadFiles(path || null);
    }

    navigateBack() {
        if (this.currentPath) {
            // 处理 Windows 路径
            const normalizedPath = this.currentPath.replace(/\\/g, '/');

            // 检查是否在驱动器根目录（如 C:\ 或 C:/）
            if (normalizedPath.match(/^[A-Za-z]:\/$/)) {
                // 返回到驱动器列表
                this.loadFiles(null);
                return;
            }

            const lastSlash = normalizedPath.lastIndexOf('/');
            if (lastSlash > 0) {
                const parentPath = normalizedPath.substring(0, lastSlash);
                // 如果父路径是驱动器（如 C:），添加反斜杠
                if (parentPath.match(/^[A-Za-z]:$/)) {
                    this.loadFiles(parentPath + '\\');
                } else {
                    this.loadFiles(parentPath);
                }
            } else {
                // 返回到驱动器列表
                this.loadFiles(null);
            }
        }
        // 如果当前没有路径，不执行任何操作（已经在驱动器列表）
    }

    /** 更新文件表头排序箭头 */
    updateFilesSortArrows() {
        const nameModeTitles = ['文件夹在前，名称 A→Z', '文件夹在前，名称 Z→A', '混合，名称 A→Z', '混合，名称 Z→A'];
        document.querySelectorAll('.files-table th.sortable').forEach(th => {
            const arrow = th.querySelector('.sort-arrow');
            if (!arrow) return;
            arrow.className = 'sort-arrow';
            if (th.dataset.sort === this.fileSortColumn) {
                if (this.fileSortColumn === 'name') {
                    const nameAsc = this.fileSortNameMode === 0 || this.fileSortNameMode === 2;
                    const folderFirst = this.fileSortNameMode <= 1;
                    if (folderFirst) arrow.classList.add('sort-folder');
                    arrow.classList.add(nameAsc ? 'sort-asc' : 'sort-desc');
                    th.title = nameModeTitles[this.fileSortNameMode];
                } else {
                    arrow.classList.add(this.fileSortAsc ? 'sort-asc' : 'sort-desc');
                    th.title = '';
                }
                th.classList.add('sorted');
            } else {
                th.title = th.dataset.sort === 'name' ? '点击在四种排序方式间切换' : '';
                th.classList.remove('sorted');
            }
        });
    }

    renderFilesList() {
        const tbody = document.getElementById('files-list');
        if (!tbody) return;

        let files = this.files;
        if (this.fileSortColumn) {
            const col = this.fileSortColumn;
            const dir = this.fileSortAsc ? 1 : -1;
            const isComposeFile = (f) => !f.isDirectory && this.isDockerComposeFile(f.name);
            const typeKey = (f) => {
                if (f.isDirectory) return (f.totalBytes != null && f.totalBytes > 0) ? '磁盘' : '文件夹';
                return isComposeFile(f) ? 'Compose' : (f.name.split('.').pop() || '文件');
            };
            const sizeVal = (f) => {
                if (f.isDirectory && f.totalBytes != null && f.totalBytes > 0) return f.totalBytes - (f.freeBytes || 0);
                return f.isDirectory ? 0 : (f.size || 0);
            };
            files = [...files].sort((a, b) => {
                let cmp = 0;
                if (col === 'name') {
                    const foldersFirst = this.fileSortNameMode <= 1;
                    const nameAsc = this.fileSortNameMode === 0 || this.fileSortNameMode === 2;
                    if (foldersFirst) {
                        const aDir = a.isDirectory ? 0 : 1;
                        const bDir = b.isDirectory ? 0 : 1;
                        if (aDir !== bDir) return aDir - bDir;
                    }
                    cmp = (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
                    return nameAsc ? cmp : -cmp;
                }
                switch (col) {
                    case 'type':
                        cmp = typeKey(a).localeCompare(typeKey(b));
                        if (cmp === 0) cmp = (a.name || '').localeCompare(b.name || '');
                        break;
                    case 'size':
                        cmp = sizeVal(a) - sizeVal(b);
                        break;
                    case 'date':
                        cmp = new Date(a.modified || 0) - new Date(b.modified || 0);
                        break;
                    default:
                        return 0;
                }
                return cmp * dir;
            });
        }

        tbody.innerHTML = files.map(file => {
            let sizeCell = '';
            if (file.isDirectory && file.totalBytes != null && file.totalBytes > 0) {
                const used = file.totalBytes - (file.freeBytes || 0);
                const pct = Math.min(100, Math.round((used / file.totalBytes) * 100));
                const barClass = pct >= 90 ? 'drive-bar-fill bar-danger' : pct >= 75 ? 'drive-bar-fill bar-warning' : 'drive-bar-fill';
                sizeCell = `<div class="drive-usage-cell">
                    <div class="drive-usage-bar" title="已用 ${pct}%">
                        <div class="${barClass}" style="width:${pct}%"></div>
                    </div>
                    <span class="drive-usage-text">已用 ${this.formatFileSize(used)} / 共 ${this.formatFileSize(file.totalBytes)} <span class="drive-usage-pct">${pct}%</span></span>
                </div>`;
            } else {
                sizeCell = file.isDirectory ? '-' : this.formatFileSize(file.size);
            }
            const rowClass = file.isDirectory ? 'file-row folder-row' : 'file-row';
            const isImage = this.isImageFile(file.name);
            const isVideo = this.isVideoFile(file.name);
            const isCompose = !file.isDirectory && this.isDockerComposeFile(file.name);

            return `
                <tr class="${rowClass}" 
                    data-path="${this.escapeHtml(file.path)}" 
                    data-is-directory="${file.isDirectory}"
                    data-name="${this.escapeHtml(file.name)}"
                    data-file-size="${file.isDirectory ? '' : (file.size || 0)}"
                    >
                    <td class="file-name-column">${file.isDirectory ? '📁' : this.getFileIcon(file.name)} ${this.escapeHtml(file.name)}</td>
                    <td class="file-type-column">${file.isDirectory ? (file.totalBytes != null && file.totalBytes > 0 ? '磁盘' : '文件夹') : (isCompose ? 'Compose' : (file.name.split('.').pop() || '文件'))}</td>
                    <td class="file-size-column">${sizeCell}</td>
                    <td class="file-date-column">${new Date(file.modified).toLocaleString()}</td>
                    <td class="file-actions-column file-actions">
                        ${!file.isDirectory
                    ? `${isCompose ? '<button class="btn-small btn-compose-manage" title="在 Compose 管理器中打开">🐳 管理</button>' : ''}
                               ${isImage ? `<button class="btn-small btn-preview">🖼️ 预览</button>` : isVideo ? `<button class="btn-small btn-preview">🎬 预览</button>` : ''}
                               ${this.isTextFile(file.name) ? '<button class="btn-small btn-edit">编辑</button>' : ''}
                               <button class="btn-small btn-download">下载</button>`
                    : ''
                }
                        <button class="btn-small danger btn-delete">删除</button>
                    </td>
                </tr>
            `;
        }).join('');

        // 保存当前目录图片列表，供预览上一张/下一张使用
        this.currentDirImageFiles = files
            .filter(f => !f.isDirectory && this.isImageFile(f.name))
            .map(f => ({ path: f.path, name: f.name }));
        // 保存当前目录视频列表，供预览上一个/下一个使用
        this.currentDirVideoFiles = files
            .filter(f => !f.isDirectory && this.isVideoFile(f.name))
            .map(f => ({ path: f.path, name: f.name }));

        // 添加事件监听器
        tbody.querySelectorAll('tr.folder-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (!e.target.closest('.file-actions')) {
                    this.loadFiles(row.dataset.path);
                }
            });
        });

        tbody.querySelectorAll('tr').forEach(row => {
            // 右键菜单
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const path = row.dataset.path;
                const isDirectory = row.dataset.isDirectory === 'true';
                const name = row.dataset.name;
                const fileSize = row.dataset.fileSize ? parseInt(row.dataset.fileSize, 10) : 0;
                this.showContextMenu(e, path, isDirectory, name, fileSize);
            });

            // 按钮事件 - Compose 管理按钮
            const composeManageBtn = row.querySelector('.btn-compose-manage');
            if (composeManageBtn) {
                composeManageBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.openComposeManager(row.dataset.path);
                });
            }

            const previewBtn = row.querySelector('.btn-preview');
            if (previewBtn) {
                previewBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.previewFile(row.dataset.path, row.dataset.name);
                });
            }

            const editBtn = row.querySelector('.btn-edit');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.editFile(row.dataset.path);
                });
            }

            const downloadBtn = row.querySelector('.btn-download');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.downloadFile(row.dataset.path);
                });
            }

            const deleteBtn = row.querySelector('.btn-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isDirectory = row.dataset.isDirectory === 'true';
                    this.deleteFile(row.dataset.path, isDirectory);
                });
            }
        });
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    isTextFile(filename) {
        if (!filename) return false;
        const ext = filename.split('.').pop().toLowerCase();
        return this.editableExtensions.includes(ext);
    }

    /**
     * 根据文件名返回对应的文件类型图标
     */
    getFileIcon(filename) {
        if (!filename) return '📄';
        const ext = filename.split('.').pop().toLowerCase();
        const name = filename.toLowerCase();

        // Docker Compose
        if (this.isDockerComposeFile(filename)) return '🐳';
        // Dockerfile
        if (name === 'dockerfile' || name.startsWith('dockerfile.')) return '🐳';

        const iconMap = {
            // 图片
            jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️',
            webp: '🖼️', svg: '🖼️', ico: '🖼️', tif: '🖼️', tiff: '🖼️',
            // 视频
            mp4: '🎬', webm: '🎬', avi: '🎬', mov: '🎬', mkv: '🎬',
            flv: '🎬', wmv: '🎬', m4v: '🎬', '3gp': '🎬', ogv: '🎬',
            // 音频
            mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵',
            wma: '🎵', m4a: '🎵',
            // 压缩包
            zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
            bz2: '📦', xz: '📦', zst: '📦',
            // 文档
            pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
            ppt: '📙', pptx: '📙', odt: '📘', ods: '📗', odp: '📙',
            // 代码 - Web
            html: '🌐', htm: '🌐', css: '🎨', js: '📜', ts: '📜',
            jsx: '⚛️', tsx: '⚛️', vue: '💚', json: '📋',
            // 代码 - 后端
            py: '🐍', java: '☕', cs: '🔷', go: '🔵', rs: '🦀',
            php: '🐘', rb: '💎', swift: '🍊', kt: '🟣',
            c: '⚙️', cpp: '⚙️', h: '⚙️', hpp: '⚙️',
            // 脚本 / Shell
            sh: '⚡', bash: '⚡', ps1: '⚡', bat: '⚡', cmd: '⚡',
            // 配置
            yaml: '⚙️', yml: '⚙️', toml: '⚙️', ini: '⚙️',
            conf: '⚙️', config: '⚙️', env: '🔐',
            // 数据
            sql: '🗃️', db: '🗃️', sqlite: '🗃️', csv: '📊', tsv: '📊',
            // 文本/文档
            md: '📝', markdown: '📝', txt: '📄', log: '📋',
            xml: '📋', rst: '📝',
            // 可执行
            exe: '⚡', msi: '⚡', dll: '🔧', so: '🔧',
            // 字体
            ttf: '🔤', otf: '🔤', woff: '🔤', woff2: '🔤',
            // 磁盘镜像
            iso: '💿', img: '💿', vmdk: '💿',
        };

        return iconMap[ext] || '📄';
    }

    isImageFile(filename) {
        if (!filename) return false;
        const ext = filename.split('.').pop().toLowerCase();
        const imageExtensions = [
            'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff'
        ];
        return imageExtensions.includes(ext);
    }

    isVideoFile(filename) {
        if (!filename) return false;
        const ext = filename.split('.').pop().toLowerCase();
        const videoExtensions = [
            'mp4', 'webm', 'ogg', 'ogv', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4v', '3gp'
        ];
        return videoExtensions.includes(ext);
    }

    getMimeTypeByExtension(filename) {
        if (!filename) return '';
        const ext = filename.split('.').pop().toLowerCase();
        const map = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            bmp: 'image/bmp',
            webp: 'image/webp',
            svg: 'image/svg+xml',
            ico: 'image/x-icon',
            tif: 'image/tiff',
            tiff: 'image/tiff',
            mp4: 'video/mp4',
            webm: 'video/webm',
            ogg: 'video/ogg',
            ogv: 'video/ogg',
            avi: 'video/x-msvideo',
            mov: 'video/quicktime',
            mkv: 'video/x-matroska',
            flv: 'video/x-flv',
            wmv: 'video/x-ms-wmv',
            m4v: 'video/x-m4v',
            '3gp': 'video/3gpp'
        };
        return map[ext] || '';
    }

    previewFile(path, name) {
        if (!path || !name) {
            return;
        }

        const isImage = this.isImageFile(name);
        const isVideo = this.isVideoFile(name);

        if (!isImage && !isVideo) {
            this.showDialog('该文件类型不支持预览', '提示');
            return;
        }

        const previewModal = document.getElementById('file-preview');
        const previewFilename = document.getElementById('preview-filename');
        const imagePreview = document.getElementById('image-preview');
        const videoPreview = document.getElementById('video-preview');
        const previewImage = document.getElementById('preview-image');
        const previewVideo = document.getElementById('preview-video');
        const downloadBtn = document.getElementById('preview-download-btn');

        if (!previewModal || !previewFilename || !imagePreview || !videoPreview || !previewImage || !previewVideo || !downloadBtn) {
            this.showDialog('预览组件初始化失败', '错误');
            return;
        }

        // 清理旧预览
        this.closePreview();

        previewFilename.textContent = `预览: ${name}`;
        imagePreview.style.display = 'none';
        videoPreview.style.display = 'none';

        const encodedPath = encodeURIComponent(path);
        const token = encodeURIComponent(this.token);

        if (isImage) {
            const list = this.currentDirImageFiles || [];
            const idx = list.findIndex(item => item.path === path);
            this.previewImageIndex = idx >= 0 ? idx : -1;

            const navPrev = document.getElementById('preview-prev-btn');
            const navNext = document.getElementById('preview-next-btn');
            const counterEl = document.getElementById('preview-counter');
            if (list.length >= 1 && navPrev && navNext && counterEl) {
                navPrev.style.display = 'flex';
                navNext.style.display = 'flex';
                counterEl.style.display = 'inline';
                this.updatePreviewCounter();
                this.updatePreviewNavButtons();
            } else {
                if (navPrev) navPrev.style.display = 'none';
                if (navNext) navNext.style.display = 'none';
                if (counterEl) counterEl.style.display = 'none';
            }

            // 图片：使用压缩预览接口，限制最大分辨率和体积
            const previewUrl = `/api/files/preview-image?path=${encodedPath}&maxWidth=1920&maxHeight=1080&quality=80&access_token=${token}`;
            previewImage.src = previewUrl;
            imagePreview.style.display = 'flex';
        } else if (isVideo) {
            const list = this.currentDirVideoFiles || [];
            const idx = list.findIndex(item => item.path === path);
            this.previewVideoIndex = idx >= 0 ? idx : -1;
            this.previewImageIndex = -1;

            const navPrev = document.getElementById('preview-video-prev-btn');
            const navNext = document.getElementById('preview-video-next-btn');
            const counterEl = document.getElementById('preview-counter');
            if (list.length >= 1 && navPrev && navNext && counterEl) {
                navPrev.style.display = 'flex';
                navNext.style.display = 'flex';
                counterEl.style.display = 'inline';
                this.updatePreviewCounter();
                this.updatePreviewNavButtons();
            } else {
                if (navPrev) navPrev.style.display = 'none';
                if (navNext) navNext.style.display = 'none';
                if (counterEl) counterEl.style.display = 'none';
            }

            // 视频：使用流式播放接口，支持 Range 请求和拖动
            const streamUrl = `/api/files/stream?path=${encodedPath}&access_token=${token}`;
            previewVideo.src = streamUrl;
            previewVideo.load();
            videoPreview.style.display = 'flex';
        }

        downloadBtn.onclick = () => this.downloadFile(path);
        previewModal.style.display = 'flex';
    }

    updatePreviewCounter() {
        const counterEl = document.getElementById('preview-counter');
        const videoPreview = document.getElementById('video-preview');
        const isVideoMode = videoPreview && videoPreview.style.display === 'flex';
        const list = isVideoMode ? (this.currentDirVideoFiles || []) : (this.currentDirImageFiles || []);
        const index = isVideoMode ? this.previewVideoIndex : this.previewImageIndex;
        if (!counterEl || list.length === 0) return;
        const current = index >= 0 ? index + 1 : 0;
        counterEl.textContent = `${current} / ${list.length}`;
    }

    /** 根据当前索引更新上一张/下一张（或上一个/下一个）按钮的禁用状态 */
    updatePreviewNavButtons() {
        const videoPreview = document.getElementById('video-preview');
        const isVideoMode = videoPreview && videoPreview.style.display === 'flex';
        const list = isVideoMode ? (this.currentDirVideoFiles || []) : (this.currentDirImageFiles || []);
        const index = isVideoMode ? this.previewVideoIndex : this.previewImageIndex;
        const prevBtn = document.getElementById(isVideoMode ? 'preview-video-prev-btn' : 'preview-prev-btn');
        const nextBtn = document.getElementById(isVideoMode ? 'preview-video-next-btn' : 'preview-next-btn');
        if (!prevBtn || !nextBtn) return;
        prevBtn.disabled = list.length <= 1 || index <= 0;
        nextBtn.disabled = list.length <= 1 || index >= list.length - 1;
    }

    previewPrevImage() {
        const list = this.currentDirImageFiles || [];
        if (list.length <= 1 || this.previewImageIndex <= 0) return;
        this.previewImageIndex--;
        this.showPreviewImageAtIndex(this.previewImageIndex);
    }

    previewNextImage() {
        const list = this.currentDirImageFiles || [];
        if (list.length <= 1 || this.previewImageIndex < 0 || this.previewImageIndex >= list.length - 1) return;
        this.previewImageIndex++;
        this.showPreviewImageAtIndex(this.previewImageIndex);
    }

    showPreviewImageAtIndex(index) {
        const list = this.currentDirImageFiles || [];
        if (index < 0 || index >= list.length) return;
        const item = list[index];
        const previewFilename = document.getElementById('preview-filename');
        const previewImage = document.getElementById('preview-image');
        const downloadBtn = document.getElementById('preview-download-btn');
        if (!item || !previewImage) return;

        const encodedPath = encodeURIComponent(item.path);
        const token = encodeURIComponent(this.token);
        const previewUrl = `/api/files/preview-image?path=${encodedPath}&maxWidth=1920&maxHeight=1080&quality=80&access_token=${token}`;

        if (previewFilename) previewFilename.textContent = `预览: ${item.name}`;
        previewImage.src = previewUrl;
        if (downloadBtn) downloadBtn.onclick = () => this.downloadFile(item.path);
        this.updatePreviewCounter();
        this.updatePreviewNavButtons();
    }

    previewPrevVideo() {
        const list = this.currentDirVideoFiles || [];
        if (list.length <= 1 || this.previewVideoIndex <= 0) return;
        this.previewVideoIndex--;
        this.showPreviewVideoAtIndex(this.previewVideoIndex);
    }

    previewNextVideo() {
        const list = this.currentDirVideoFiles || [];
        if (list.length <= 1 || this.previewVideoIndex < 0 || this.previewVideoIndex >= list.length - 1) return;
        this.previewVideoIndex++;
        this.showPreviewVideoAtIndex(this.previewVideoIndex);
    }

    showPreviewVideoAtIndex(index) {
        const list = this.currentDirVideoFiles || [];
        if (index < 0 || index >= list.length) return;
        const item = list[index];
        const previewFilename = document.getElementById('preview-filename');
        const previewVideo = document.getElementById('preview-video');
        const downloadBtn = document.getElementById('preview-download-btn');
        if (!item || !previewVideo) return;

        const encodedPath = encodeURIComponent(item.path);
        const token = encodeURIComponent(this.token);
        const streamUrl = `/api/files/stream?path=${encodedPath}&access_token=${token}`;

        if (previewFilename) previewFilename.textContent = `预览: ${item.name}`;
        previewVideo.src = streamUrl;
        previewVideo.load();
        if (downloadBtn) downloadBtn.onclick = () => this.downloadFile(item.path);
        this.updatePreviewCounter();
        this.updatePreviewNavButtons();
    }

    closePreview() {
        const previewModal = document.getElementById('file-preview');
        const imagePreview = document.getElementById('image-preview');
        const videoPreview = document.getElementById('video-preview');
        const previewImage = document.getElementById('preview-image');
        const previewVideo = document.getElementById('preview-video');

        if (previewImage) {
            previewImage.src = '';
        }

        if (previewVideo) {
            previewVideo.pause();
            previewVideo.removeAttribute('src');
            previewVideo.load();
        }

        if (imagePreview) {
            imagePreview.style.display = 'none';
        }

        if (videoPreview) {
            videoPreview.style.display = 'none';
        }

        if (previewModal) {
            previewModal.style.display = 'none';
        }

        this.previewImageIndex = -1;
        this.previewVideoIndex = -1;
        const navPrev = document.getElementById('preview-prev-btn');
        const navNext = document.getElementById('preview-next-btn');
        if (navPrev) navPrev.style.display = 'none';
        if (navNext) navNext.style.display = 'none';
        const videoNavPrev = document.getElementById('preview-video-prev-btn');
        const videoNavNext = document.getElementById('preview-video-next-btn');
        if (videoNavPrev) videoNavPrev.style.display = 'none';
        if (videoNavNext) videoNavNext.style.display = 'none';
        const counterEl = document.getElementById('preview-counter');
        if (counterEl) counterEl.style.display = 'none';
    }

    async editFile(path, options = {}) {
        const forceEdit = options.forceEdit === true;
        try {
            const response = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const result = await response.json();
                const editor = document.getElementById('file-editor');
                const textEl = document.getElementById('file-content-editor');
                const hexEl = document.getElementById('file-hex-editor');
                const hexContent = document.getElementById('file-hex-content');
                const modeToggle = document.getElementById('editor-mode-toggle');

                editor.dataset.path = path;
                editor.dataset.forceEdit = forceEdit ? '1' : '0';
                editor.dataset.editorMode = 'text';
                document.getElementById('editor-filename').textContent = (forceEdit ? '强制编辑: ' : 'Edit: ') + path;

                textEl.value = result.content ?? '';
                textEl.style.display = 'block';
                hexEl.style.display = 'none';
                hexContent.value = '';

                if (forceEdit) {
                    modeToggle.style.display = 'flex';
                    modeToggle.querySelectorAll('.editor-mode-btn').forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.mode === 'text');
                    });
                } else {
                    modeToggle.style.display = 'none';
                }
                editor.style.display = 'block';
            }
        } catch (error) {
            this.showDialog('打开文件失败: ' + error.message, '错误');
        }
    }

    /**
     * 将字节数组转为三栏数据：offset | hex | ascii（每行 16 字节）
     * @returns {{ offsets: string, hex: string, ascii: string }}
     */
    bytesToHexDumpLines(bytes) {
        const offsets = [];
        const hexLines = [];
        const asciiLines = [];
        if (!bytes || !bytes.length) {
            return { offsets: '', hex: '', ascii: '' };
        }
        for (let i = 0; i < bytes.length; i += 16) {
            const chunk = bytes.subarray(i, Math.min(i + 16, bytes.length));
            offsets.push(('00000000' + i.toString(16)).slice(-8));
            const hex = Array.from(chunk, b => ('0' + b.toString(16)).slice(-2)).join(' ');
            const hexPadded = (hex + '                                 ').slice(0, 47);
            hexLines.push(hexPadded);
            asciiLines.push(Array.from(chunk, b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join(''));
        }
        return {
            offsets: offsets.join('\n'),
            hex: hexLines.join('\n'),
            ascii: asciiLines.join('\n')
        };
    }

    /** 从十六进制字符串解析出字节数组（仅提取 xx 形式字节，忽略 offset/ascii） */
    hexDumpToBytes(hexDumpStr) {
        const hexPairs = (hexDumpStr || '').match(/\b[0-9a-fA-F]{2}\b/g);
        if (!hexPairs || hexPairs.length === 0) return new Uint8Array(0);
        return new Uint8Array(hexPairs.map(h => parseInt(h, 16)));
    }

    /** 仅允许十六进制字符与空白，返回过滤后的字符串及对应的新选区起止位置 */
    sanitizeHexInput(str, selectionStart, selectionEnd) {
        const allowed = /[0-9a-fA-F\s]/;
        let out = '';
        let newStart = 0, newEnd = 0;
        for (let i = 0; i <= (str.length || 0); i++) {
            if (i === selectionStart) newStart = out.length;
            if (i === selectionEnd) newEnd = out.length;
            if (i < str.length && allowed.test(str[i])) out += str[i];
        }
        newEnd = Math.max(newEnd, newStart);
        return { sanitized: out, newStart, newEnd };
    }

    /** 十六进制输入校验：限制为合法字符并更新两侧栏 */
    handleHexEditorInput() {
        const hexContent = document.getElementById('file-hex-content');
        if (!hexContent) return;
        const start = hexContent.selectionStart;
        const end = hexContent.selectionEnd;
        const { sanitized, newStart, newEnd } = this.sanitizeHexInput(hexContent.value, start, end);
        if (sanitized !== hexContent.value) {
            hexContent.value = sanitized;
            hexContent.setSelectionRange(newStart, newEnd);
        }
        this.updateHexEditorSidePanels();
    }

    /** 粘贴时只插入合法十六进制字符 */
    handleHexEditorPaste(ev) {
        const hexContent = document.getElementById('file-hex-content');
        if (!hexContent || !ev.clipboardData) return;
        const raw = ev.clipboardData.getData('text');
        const { sanitized } = this.sanitizeHexInput(raw, 0, 0);
        if (sanitized === raw) return;
        ev.preventDefault();
        const start = hexContent.selectionStart;
        const end = hexContent.selectionEnd;
        const before = hexContent.value.slice(0, start);
        const after = hexContent.value.slice(end);
        hexContent.value = before + sanitized + after;
        hexContent.setSelectionRange(start + sanitized.length, start + sanitized.length);
        this.updateHexEditorSidePanels();
    }

    /** 根据当前 hex 文本框内容更新 offset 与 ascii 栏（编辑时联动） */
    updateHexEditorSidePanels() {
        const hexContent = document.getElementById('file-hex-content');
        const offsetEl = document.getElementById('file-hex-offset');
        const asciiEl = document.getElementById('file-hex-ascii');
        if (!hexContent || !offsetEl || !asciiEl) return;
        const lines = hexContent.value.split('\n').filter(l => l.trim().length > 0);
        const offsets = [];
        const asciiLines = [];
        for (let i = 0; i < lines.length; i++) {
            offsets.push(('00000000' + (i * 16).toString(16)).slice(-8));
            const bytes = this.hexDumpToBytes(lines[i]);
            asciiLines.push(Array.from(bytes, b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join(''));
        }
        offsetEl.textContent = offsets.join('\n') || '';
        asciiEl.textContent = asciiLines.join('\n') || '';
    }

    /** 绑定十六进制编辑器三栏滚动同步（左/右为列 div 滚动，中间为 textarea 滚动） */
    bindHexEditorScrollSync() {
        const colOffset = document.querySelector('.hex-editor-col-offset');
        const colAscii = document.querySelector('.hex-editor-col-ascii');
        const hexContent = document.getElementById('file-hex-content');
        if (!colOffset || !colAscii || !hexContent) return;

        const setScroll = (top) => {
            colOffset.scrollTop = top;
            hexContent.scrollTop = top;
            colAscii.scrollTop = top;
        };

        colOffset.addEventListener('scroll', () => setScroll(colOffset.scrollTop));
        hexContent.addEventListener('scroll', () => setScroll(hexContent.scrollTop));
        colAscii.addEventListener('scroll', () => setScroll(colAscii.scrollTop));
    }

    async switchEditorMode(mode) {
        const editor = document.getElementById('file-editor');
        const path = editor.dataset.path;
        const textEl = document.getElementById('file-content-editor');
        const hexEl = document.getElementById('file-hex-editor');
        const hexContent = document.getElementById('file-hex-content');

        if (mode === 'hex') {
            try {
                const response = await fetch(`/api/files/read?path=${encodeURIComponent(path)}&binary=true`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (response.ok) {
                    const buffer = await response.arrayBuffer();
                    const bytes = new Uint8Array(buffer);
                    const { offsets, hex, ascii } = this.bytesToHexDumpLines(bytes);
                    const offsetEl = document.getElementById('file-hex-offset');
                    const asciiEl = document.getElementById('file-hex-ascii');
                    if (offsetEl) offsetEl.textContent = offsets;
                    hexContent.value = hex;
                    if (asciiEl) asciiEl.textContent = ascii;
                    this.bindHexEditorScrollSync();
                    hexContent.removeEventListener('input', this._hexEditorInputHandler);
                    hexContent.removeEventListener('paste', this._hexEditorPasteHandler);
                    this._hexEditorInputHandler = () => this.handleHexEditorInput();
                    this._hexEditorPasteHandler = (e) => this.handleHexEditorPaste(e);
                    hexContent.addEventListener('input', this._hexEditorInputHandler);
                    hexContent.addEventListener('paste', this._hexEditorPasteHandler);
                    editor.dataset.editorMode = 'hex';
                    textEl.style.display = 'none';
                    hexEl.style.display = 'flex';
                } else {
                    const err = await response.json().catch(() => ({}));
                    this.showDialog(err.message || '读取二进制失败', '错误');
                }
            } catch (e) {
                this.showDialog('读取二进制失败: ' + e.message, '错误');
                return;
            }
        } else {
            hexContent.removeEventListener('input', this._hexEditorInputHandler);
            hexContent.removeEventListener('paste', this._hexEditorPasteHandler);
            const currentHex = hexContent.value;
            if (currentHex.trim()) {
                const bytes = this.hexDumpToBytes(currentHex);
                if (bytes.length) {
                    textEl.value = Array.from(bytes, b => b >= 32 && b < 127 ? String.fromCharCode(b) : '\ufffd').join('');
                }
            }
            editor.dataset.editorMode = 'text';
            hexContent.value = '';
            document.getElementById('file-hex-offset').textContent = '';
            document.getElementById('file-hex-ascii').textContent = '';
            hexEl.style.display = 'none';
            textEl.style.display = 'block';
        }
        editor.querySelectorAll('.editor-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }

    async saveFile() {
        const editor = document.getElementById('file-editor');
        const path = editor.dataset.path;
        const mode = editor.dataset.editorMode || 'text';
        const textEl = document.getElementById('file-content-editor');
        const hexContent = document.getElementById('file-hex-content');

        try {
            let response;
            if (mode === 'hex') {
                const bytes = this.hexDumpToBytes(hexContent.value);
                if (!bytes.length) {
                    this.showDialog('十六进制内容无效或为空', '错误');
                    return;
                }
                response = await fetch(`/api/files/write-binary?path=${encodeURIComponent(path)}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/octet-stream'
                    },
                    body: bytes
                });
            } else {
                response = await fetch('/api/files/write', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ path, content: textEl.value })
                });
            }

            const data = await response.json().catch(() => ({ message: response.statusText }));
            this.showDialog(data.message || (response.ok ? '保存成功' : '保存失败'), response.ok ? '成功' : '错误');
            if (response.ok) {
                editor.style.display = 'none';
            }
        } catch (error) {
            this.showDialog('保存失败: ' + error.message, '错误');
        }
    }

    closeFileEditor() {
        document.getElementById('file-editor').style.display = 'none';
    }

    downloadFile(path) {
        window.location.href = `/api/files/download?path=${encodeURIComponent(path)}&access_token=${this.token}`;
    }

    async deleteFile(path, isDirectory) {
        const confirmed = await this.showDialog(
            `确定要删除此${isDirectory ? '文件夹' : '文件'}吗？`,
            '确认删除',
            { type: 'confirm' }
        );

        if (!confirmed) {
            return;
        }

        try {
            const url = isDirectory
                ? `/api/files/delete-directory?path=${encodeURIComponent(path)}`
                : `/api/files/delete?path=${encodeURIComponent(path)}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            const data = await response.json();
            this.showDialog(data.message, response.ok ? '成功' : '错误');
            if (response.ok) {
                this.loadFiles(this.currentPath || null);
            }
        } catch (error) {
            this.showDialog('删除失败: ' + error.message, '错误');
        }
    }

    async uploadFile() {
        const fileInput = document.getElementById('file-upload');
        if (fileInput.files.length === 0) {
            this.showDialog('请选择要上传的文件', '提示');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        const currentPath = this.currentPath || '';
        const url = currentPath ? `/api/files/upload?path=${encodeURIComponent(currentPath)}` : '/api/files/upload';
        const progressBar = document.getElementById('upload-progress');
        progressBar.style.display = 'block';

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` },
                body: formData
            });

            const data = await response.json();
            this.showDialog(data.message);
            if (response.ok) {
                fileInput.value = '';
                progressBar.style.display = 'none';
                this.loadFiles(currentPath || null);
            }
        } catch (error) {
            progressBar.style.display = 'none';
            this.showDialog('上传失败: ' + error.message, '错误');
        }
    }

    async createFile(fileName) {
        try {
            const currentPath = this.currentPath || '';
            const fullPath = currentPath ? `${currentPath}/${fileName}` : fileName;
            const response = await fetch('/api/files/write', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path: fullPath, content: '' })
            });

            const data = await response.json();
            this.showDialog(data.message || (response.ok ? '创建成功' : '创建失败'), response.ok ? '成功' : '错误');
            if (response.ok) {
                this.loadFiles(currentPath || null);
            }
        } catch (error) {
            this.showDialog('新建文件失败: ' + error.message, '错误');
        }
    }

    async createFolder(folderName) {
        try {
            const currentPath = this.currentPath || '';
            const fullPath = currentPath ? `${currentPath}/${folderName}` : folderName;
            const response = await fetch('/api/files/create-directory', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path: fullPath })
            });

            const data = await response.json();
            this.showDialog(data.message, response.ok ? '成功' : '错误');
            if (response.ok) {
                this.loadFiles(currentPath || null);
            }
        } catch (error) {
            this.showDialog('创建文件夹失败: ' + error.message, '错误');
        }
    }

    // ============ Context Menu Methods ============

    showContextMenu(event, path, isDirectory, name, fileSize = 0) {
        event.preventDefault();
        event.stopPropagation();

        // 移除已存在的菜单
        this.hideContextMenu();

        // 创建右键菜单
        const contextMenu = document.createElement('div');
        contextMenu.id = 'context-menu';
        contextMenu.className = 'context-menu';

        // 存储路径信息到 data 属性
        contextMenu.dataset.path = path;
        contextMenu.dataset.isDirectory = isDirectory;
        contextMenu.dataset.name = name;

        let menuItems = '';

        if (isDirectory) {
            // 文件夹菜单
            menuItems = `
                <div class="context-menu-item" data-action="open">
                    <span class="menu-icon">📂</span>
                    <span>打开文件夹</span>
                </div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="rename">
                    <span class="menu-icon">✏️</span>
                    <span>重命名</span>
                </div>
                <div class="context-menu-item danger" data-action="delete">
                    <span class="menu-icon">🗑️</span>
                    <span>删除文件夹</span>
                </div>
            `;
        } else {
            // 文件菜单
            const canEdit = this.isTextFile(name);
            const isCompose = this.isDockerComposeFile(name);
            const sizeBytes = typeof fileSize === 'number' ? fileSize : parseInt(fileSize, 10) || 0;
            const canForceEdit = sizeBytes > 0 && sizeBytes < 2 * 1024 * 1024; // 小于 2MB
            menuItems = `
                ${isCompose ? `<div class="context-menu-item" data-action="compose-manage">
                    <span class="menu-icon">🐳</span>
                    <span>Compose 管理</span>
                </div>
                <div class="context-menu-separator"></div>` : ''}
                ${canEdit ? `<div class="context-menu-item" data-action="edit">
                    <span class="menu-icon">📝</span>
                    <span>编辑</span>
                </div>` : ''}
                ${canForceEdit ? `<div class="context-menu-item" data-action="force-edit">
                    <span class="menu-icon">📝</span>
                    <span>强制编辑</span>
                </div>` : ''}
                <div class="context-menu-item" data-action="download">
                    <span class="menu-icon">💾</span>
                    <span>下载</span>
                </div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="rename">
                    <span class="menu-icon">✏️</span>
                    <span>重命名</span>
                </div>
                <div class="context-menu-item danger" data-action="delete">
                    <span class="menu-icon">🗑️</span>
                    <span>删除文件</span>
                </div>
            `;
        }

        contextMenu.innerHTML = menuItems;
        document.body.appendChild(contextMenu);

        // 添加菜单项点击事件
        contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                const menuPath = contextMenu.dataset.path;
                const menuIsDirectory = contextMenu.dataset.isDirectory === 'true';
                const menuName = contextMenu.dataset.name;

                switch (action) {
                    case 'open':
                        this.loadFiles(menuPath);
                        break;
                    case 'compose-manage':
                        this.openComposeManager(menuPath);
                        break;
                    case 'edit':
                        this.editFile(menuPath);
                        break;
                    case 'force-edit':
                        this.editFile(menuPath, { forceEdit: true });
                        break;
                    case 'download':
                        this.downloadFile(menuPath);
                        break;
                    case 'rename':
                        this.renameFile(menuPath, menuIsDirectory, menuName);
                        break;
                    case 'delete':
                        this.deleteFile(menuPath, menuIsDirectory);
                        break;
                }

                this.hideContextMenu();
            });
        });

        // 定位菜单
        const x = event.clientX;
        const y = event.clientY;
        const menuWidth = 200;
        const menuHeight = contextMenu.offsetHeight;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // 确保菜单不会超出屏幕
        const left = (x + menuWidth > windowWidth) ? windowWidth - menuWidth - 10 : x;
        const top = (y + menuHeight > windowHeight) ? windowHeight - menuHeight - 10 : y;

        contextMenu.style.left = left + 'px';
        contextMenu.style.top = top + 'px';
    }

    hideContextMenu() {
        const contextMenu = document.getElementById('context-menu');
        if (contextMenu) {
            contextMenu.remove();
        }
    }

    async renameFile(oldPath, isDirectory, currentName) {
        const newName = prompt(`重命名${isDirectory ? '文件夹' : '文件'}:`, currentName);
        if (!newName || newName === currentName) {
            return;
        }

        try {
            // 构造新路径
            const pathParts = oldPath.replace(/\\/g, '/').split('/');
            pathParts[pathParts.length - 1] = newName;
            const newPath = pathParts.join('/');

            const response = await fetch('/api/files/rename', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    oldPath: oldPath,
                    newPath: newPath
                })
            });

            const data = await response.json();
            this.showDialog(data.message, response.ok ? '成功' : '错误');

            if (response.ok) {
                this.loadFiles(this.currentPath);
            }
        } catch (error) {
            this.showDialog('重命名失败: ' + error.message, '错误');
        }
    }
}

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new RemoteControl();
});

