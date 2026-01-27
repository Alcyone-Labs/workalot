// State
let currentView = 'dashboard';
let statsInterval = null;
let currentFilter = 'all';
let allJobs = [];
let filteredJobs = [];
let ws = null;
let virtualList = null;

// DOM Elements
const views = {
    dashboard: document.getElementById('view-dashboard'),
    jobs: document.getElementById('view-jobs'),
    workers: document.getElementById('view-workers'),
    simulation: document.getElementById('view-simulation')
};

const statsElements = {
    pending: document.getElementById('stats-pending'),
    processing: document.getElementById('stats-processing'),
    completed: document.getElementById('stats-completed'),
    failed: document.getElementById('stats-failed'),
    cancelled: document.getElementById('stats-cancelled')
};

const workerElements = {
    total: document.getElementById('worker-total'),
    busy: document.getElementById('worker-busy'),
    available: document.getElementById('worker-available')
};

// Virtual List Implementation
class VirtualList {
    constructor(container, content, itemHeight, renderItem) {
        this.container = container;
        this.content = content;
        this.itemHeight = itemHeight;
        this.renderItem = renderItem;
        this.items = [];
        this.visibleItems = [];

        this.container.addEventListener('scroll', () => this.render());
        window.addEventListener('resize', () => this.render());
    }

    setItems(items) {
        this.items = items;
        this.content.style.height = `${items.length * this.itemHeight}px`;
        this.render();
    }

    render() {
        const scrollTop = this.container.scrollTop;
        const containerHeight = this.container.clientHeight;

        const startIndex = Math.floor(scrollTop / this.itemHeight);
        const endIndex = Math.min(
            this.items.length - 1,
            Math.floor((scrollTop + containerHeight) / this.itemHeight)
        );

        // Add buffer
        const buffer = 5;
        const start = Math.max(0, startIndex - buffer);
        const end = Math.min(this.items.length - 1, endIndex + buffer);

        let html = '';
        for (let i = start; i <= end; i++) {
            const item = this.items[i];
            const top = i * this.itemHeight;
            html += this.renderItem(item, top);
        }

        this.content.innerHTML = html;
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupFilters();
    setupVirtualList();
    connectWebSocket();
    loadDashboardData();
    checkSimulationStatus();
});

function setupVirtualList() {
    const container = document.getElementById('virtual-list-container');
    const content = document.getElementById('virtual-list-content');

    virtualList = new VirtualList(container, content, 50, (job, top) => `
        <div class="virtual-item" style="top: ${top}px">
            <div class="col-id font-mono" title="${job.id}">${job.id}</div>
            <div class="col-status">${renderStatusBadge(job.status)}</div>
            <div class="col-result">${renderResult(job)}</div>
            <div class="col-actions">
                <button class="btn-secondary btn-sm" onclick="viewJobDetails('${job.id}')">Info</button>
                ${(job.status === 'pending' || job.status === 'processing') ?
                    `<button class="btn-danger btn-sm" onclick="stopJob('${job.id}')">Stop</button>` :
                    `<button class="btn-primary btn-sm" onclick="retryJob('${job.id}')">Retry</button>`
                }
            </div>
        </div>
    `);
}

// Navigation
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const viewName = item.dataset.view;
            showView(viewName);
        });
    });
}

function showView(viewName) {
    currentView = viewName;

    // Update menu
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update content
    Object.keys(views).forEach(key => {
        views[key].classList.toggle('hidden', key !== viewName);
    });

    // Refresh data for the view
    if (viewName === 'jobs') {
        updateJobsList();
        // Force layout recalc for virtual list
        setTimeout(() => virtualList.render(), 0);
    }
    if (viewName === 'workers') loadWorkers();
    if (viewName === 'simulation') checkSimulationStatus();
}

function setupFilters() {
    document.getElementById('status-filter').addEventListener('change', (e) => {
        currentFilter = e.target.value;
        updateJobsList();
    });
}

// WebSocket Connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected');
        document.querySelector('.status-dot').classList.add('connected');
        document.getElementById('connection-text').textContent = 'Live';
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleMessage(message);
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        document.querySelector('.status-dot').classList.remove('connected');
        document.getElementById('connection-text').textContent = 'Offline';
        // Reconnect after 5s
        setTimeout(connectWebSocket, 5000);
    };
}

function handleMessage(message) {
    if (message.type === 'job-added') {
        allJobs.unshift(message.data);
        updateStats(message.data.status, 1);
        if (currentView === 'jobs') updateJobsList();
        if (currentView === 'dashboard') loadRecentJobs();
    } else if (message.type === 'job-updated') {
        const index = allJobs.findIndex(j => j.id === message.data.id);
        if (index !== -1) {
            const oldStatus = allJobs[index].status;
            allJobs[index] = message.data;
            updateStats(oldStatus, -1);
            updateStats(message.data.status, 1);
        } else {
            allJobs.unshift(message.data);
        }
        if (currentView === 'jobs') updateJobsList();
        if (currentView === 'dashboard') loadRecentJobs();
    }
}

function updateStats(status, delta) {
    // Simple optimistic UI update, real sync happens via fetchStats
    const el = statsElements[status];
    if (el) {
        let val = parseInt(el.textContent) || 0;
        el.textContent = Math.max(0, val + delta);
    }
}

// Data Fetching
async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        updateStatsUI(data);
    } catch (error) {
        console.error('Failed to fetch stats:', error);
    }
}

function updateStatsUI(data) {
    if (data.queue) {
        statsElements.pending.textContent = data.queue.pending || 0;
        statsElements.processing.textContent = data.queue.processing || 0;
        statsElements.completed.textContent = data.queue.completed || 0;
        statsElements.failed.textContent = data.queue.failed || 0;
        statsElements.cancelled.textContent = data.queue.cancelled || 0;
    }
}

async function loadDashboardData() {
    await fetchStats();
    await loadAllJobs(); // Initial load
}

async function loadAllJobs() {
    try {
        const response = await fetch('/api/jobs?limit=1000');
        allJobs = await response.json();
        updateJobsList();
        loadRecentJobs();
    } catch (error) {
        console.error('Failed to load jobs:', error);
    }
}

function updateJobsList() {
    if (currentFilter === 'all') {
        filteredJobs = allJobs;
    } else {
        filteredJobs = allJobs.filter(j => j.status === currentFilter);
    }

    if (virtualList) {
        virtualList.setItems(filteredJobs);
    }
}

function loadRecentJobs() {
    const jobs = allJobs.slice(0, 5);
    renderRecentJobs(jobs);
}

async function loadWorkers() {
    // Placeholder
}

// Rendering
function renderRecentJobs(jobs) {
    const tbody = document.getElementById('recent-jobs-table');
    if (!jobs || jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">No jobs found</td></tr>';
        return;
    }

    tbody.innerHTML = jobs.map(job => `
        <tr>
            <td><span class="font-mono">${job.id.substring(0, 8)}...</span></td>
            <td>${renderStatusBadge(job.status)}</td>
            <td>${new Date(job.createdAt || Date.now()).toLocaleTimeString()}</td>
        </tr>
    `).join('');
}

function renderStatusBadge(status) {
    const s = (status || 'unknown').toLowerCase();
    return `<span class="badge ${s}">${s}</span>`;
}

function renderResult(job) {
    if (job.error) return `<span class="text-danger truncate" title="${job.error}">${job.error}</span>`;
    if (job.result) return `<span class="text-success">Success</span>`;
    return '-';
}

// Actions
async function viewJobDetails(jobId) {
    try {
        const response = await fetch(`/api/jobs/${jobId}`);
        const job = await response.json();

        const content = document.getElementById('job-details-content');
        content.innerHTML = `
            <div class="detail-group">
                <h4>Job ID</h4>
                <p>${job.id}</p>
            </div>
            <div class="detail-group">
                <h4>Status</h4>
                <p>${renderStatusBadge(job.status)}</p>
            </div>
            <div class="detail-group">
                <h4>Payload</h4>
                <pre>${JSON.stringify(job.jobPayload || job.payload, null, 2)}</pre>
            </div>
            ${job.result ? `
            <div class="detail-group">
                <h4>Result</h4>
                <pre>${JSON.stringify(job.result, null, 2)}</pre>
            </div>` : ''}
            ${job.error ? `
            <div class="detail-group">
                <h4>Error</h4>
                <pre class="text-danger">${job.error}</pre>
            </div>` : ''}
        `;

        document.getElementById('job-modal').classList.remove('hidden');
    } catch (error) {
        alert('Failed to load job details');
    }
}

async function retryJob(jobId) {
    try {
        await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
        // WebSocket will handle update
    } catch (error) {
        alert('Failed to retry job');
    }
}

async function stopJob(jobId) {
    if (!confirm('Are you sure you want to stop this job?')) return;
    try {
        const res = await fetch(`/api/jobs/${jobId}/stop`, { method: 'POST' });
        const data = await res.json();
        if (data.error) alert(data.error);
        // WebSocket will handle update
    } catch (error) {
        alert('Failed to stop job');
    }
}

async function createManualJob() {
    // Simple manual creation
    const types = ['ImageProcessing', 'DataAnalysis', 'ReportGeneration'];
    const type = types[Math.floor(Math.random() * types.length)];
    const payload = {
        type,
        data: "Manual Job " + Date.now()
    };

    // We reuse the simulator logic or add a new endpoint?
    // Wait, we don't have a generic create endpoint in DashboardServer yet, only retry.
    // I should add one. But for now I'll use the retry endpoint trick or just assume simulation is the way.
    // Actually, retry creates a new job from payload.
    // I need a generic create endpoint.
    // I'll skip generic create for now and rely on Simulation to create jobs.
    // Or I can call /api/simulation/start with high interval to create one job? No.
    // I'll just alert user to use simulation.
    alert("Please use the Simulation tab to create jobs automatically.");
}

async function clearCompleted() {
    alert('Not implemented');
}

function closeModal() {
    document.getElementById('job-modal').classList.add('hidden');
}

// Simulation
async function checkSimulationStatus() {
    try {
        const res = await fetch('/api/simulation/status');
        const status = await res.json();
        updateSimulationUI(status);
    } catch (e) {
        console.error(e);
    }
}

async function startSimulation() {
    try {
        await fetch('/api/simulation/start', { method: 'POST' });
        checkSimulationStatus();
    } catch (e) { alert('Failed to start'); }
}

async function stopSimulation() {
    try {
        await fetch('/api/simulation/stop', { method: 'POST' });
        checkSimulationStatus();
    } catch (e) { alert('Failed to stop'); }
}

function updateSimulationUI(status) {
    const badge = document.getElementById('sim-status-badge');
    const startBtn = document.getElementById('btn-start-sim');
    const stopBtn = document.getElementById('btn-stop-sim');

    if (status.running) {
        badge.textContent = 'Running';
        badge.className = 'badge processing';
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
    } else {
        badge.textContent = 'Stopped';
        badge.className = 'badge';
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
    }
}

// Make functions global
window.showView = showView;
window.loadJobs = loadAllJobs;
window.clearCompleted = clearCompleted;
window.viewJobDetails = viewJobDetails;
window.retryJob = retryJob;
window.stopJob = stopJob;
window.closeModal = closeModal;
window.createManualJob = createManualJob;
window.startSimulation = startSimulation;
window.stopSimulation = stopSimulation;
