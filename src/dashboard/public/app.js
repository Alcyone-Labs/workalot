// State
let currentView = 'dashboard';
let statsInterval = null;
let currentFilter = 'all';

// DOM Elements
const views = {
    dashboard: document.getElementById('view-dashboard'),
    jobs: document.getElementById('view-jobs'),
    workers: document.getElementById('view-workers')
};

const statsElements = {
    pending: document.getElementById('stats-pending'),
    processing: document.getElementById('stats-processing'),
    completed: document.getElementById('stats-completed'),
    failed: document.getElementById('stats-failed')
};

const workerElements = {
    total: document.getElementById('worker-total'),
    busy: document.getElementById('worker-busy'),
    available: document.getElementById('worker-available')
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupFilters();
    startPolling();
    loadDashboardData();
});

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
    if (viewName === 'jobs') loadJobs();
    if (viewName === 'workers') loadWorkers();
}

function setupFilters() {
    document.getElementById('status-filter').addEventListener('change', (e) => {
        currentFilter = e.target.value;
        loadJobs();
    });
}

// Data Fetching
async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        updateStatsUI(data);
        document.querySelector('.status-dot').classList.add('connected');
        document.getElementById('connection-text').textContent = 'Connected';
    } catch (error) {
        console.error('Failed to fetch stats:', error);
        document.querySelector('.status-dot').classList.remove('connected');
        document.getElementById('connection-text').textContent = 'Disconnected';
    }
}

function updateStatsUI(data) {
    // Queue Stats
    if (data.queue) {
        statsElements.pending.textContent = data.queue.pending || 0;
        statsElements.processing.textContent = data.queue.processing || 0;
        statsElements.completed.textContent = data.queue.completed || 0;
        statsElements.failed.textContent = data.queue.failed || 0;
    }

    // Worker Stats
    if (data.workers) {
        workerElements.total.textContent = data.workers.totalWorkers || 0;
        workerElements.busy.textContent = data.workers.busyWorkers || 0;
        workerElements.available.textContent = data.workers.availableWorkers || 0;
    }
}

async function loadDashboardData() {
    await fetchStats();
    await loadRecentJobs();
}

async function loadRecentJobs() {
    try {
        const response = await fetch('/api/jobs?limit=5');
        const jobs = await response.json();
        renderRecentJobs(jobs);
    } catch (error) {
        console.error('Failed to load recent jobs:', error);
    }
}

async function loadJobs() {
    const tableBody = document.getElementById('jobs-table');
    tableBody.innerHTML = '<tr><td colspan="4" class="text-center">Loading...</td></tr>';

    try {
        let url = '/api/jobs?limit=50';
        if (currentFilter !== 'all') {
            url += `&status=${currentFilter}`;
        }

        const response = await fetch(url);
        const jobs = await response.json();
        renderJobsTable(jobs);
    } catch (error) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Error loading jobs: ${error.message}</td></tr>`;
    }
}

async function loadWorkers() {
    // Placeholder for detailed worker view
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
            <td>${formatTime(job.requestedAt || job.createdAt || job.startedAt || job.completedAt)}</td>
        </tr>
    `).join('');
}

function renderJobsTable(jobs) {
    const tbody = document.getElementById('jobs-table');
    if (!jobs || jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No jobs found</td></tr>';
        return;
    }

    tbody.innerHTML = jobs.map(job => `
        <tr>
            <td class="font-mono">${job.id}</td>
            <td>${renderStatusBadge(job.status)}</td>
            <td>${renderResult(job)}</td>
            <td>
                <button class="btn-secondary btn-sm" onclick="viewJobDetails('${job.id}')">Details</button>
                ${job.status === 'failed' ? `<button class="btn-primary btn-sm" onclick="retryJob('${job.id}')">Retry</button>` : ''}
            </td>
        </tr>
    `).join('');
}

function renderStatusBadge(status) {
    const s = (status || 'unknown').toLowerCase();
    return `<span class="badge ${s}">${s}</span>`;
}

function renderResult(job) {
    if (job.error) return `<span class="text-danger truncate">${job.error}</span>`;
    if (job.result) return `<span class="text-success">Success</span>`;
    return '-';
}

// Actions
async function viewJobDetails(jobId) {
    try {
        const response = await fetch(`/api/jobs/${jobId}`);
        const job = await response.json();
        const jobPayload = job.jobPayload || job.payload;

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
                <pre>${JSON.stringify(jobPayload, null, 2)}</pre>
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
    if (!confirm('Are you sure you want to retry this job?')) return;

    try {
        await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
        loadJobs();
        fetchStats();
    } catch (error) {
        alert('Failed to retry job');
    }
}

async function clearCompleted() {
    if (!confirm('Are you sure you want to clear all completed jobs?')) return;
    // Implementation depends on backend capabilities
    alert('Clear completed not implemented in this demo');
}

function closeModal() {
    document.getElementById('job-modal').classList.add('hidden');
}

function startPolling() {
    fetchStats();
    statsInterval = setInterval(fetchStats, 2000);
}

function formatTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleTimeString();
}
