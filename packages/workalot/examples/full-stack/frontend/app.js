// API Base URL
const API_BASE = '/api';

// Current job type
let currentJobType = 'image-processing';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupJobTypeSelector();
    loadStats();
    loadJobs();
    
    // Auto-refresh stats and jobs
    setInterval(loadStats, 2000);
    setInterval(loadJobs, 3000);
});

// Setup job type selector
function setupJobTypeSelector() {
    const buttons = document.querySelectorAll('.job-type-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const type = btn.dataset.type;
            currentJobType = type;
            
            // Hide all forms
            document.querySelectorAll('.job-form').forEach(form => {
                form.classList.add('hidden');
            });
            
            // Show selected form
            document.getElementById(`${type}-form`).classList.remove('hidden');
        });
    });
}

// Load statistics
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/stats`);
        const data = await response.json();
        
        document.getElementById('total-jobs').textContent = data.jobs.total;
        document.getElementById('running-jobs').textContent = data.jobs.byStatus.running;
        document.getElementById('completed-jobs').textContent = data.jobs.byStatus.completed;
        document.getElementById('worker-count').textContent = data.workers.total;
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Load jobs list
async function loadJobs() {
    try {
        const response = await fetch(`${API_BASE}/jobs`);
        const data = await response.json();
        
        const container = document.getElementById('jobs-container');
        
        if (data.jobs.length === 0) {
            container.innerHTML = '<div class="empty-state">No jobs yet. Submit a job to get started!</div>';
            return;
        }
        
        container.innerHTML = data.jobs.map(job => createJobCard(job)).join('');
    } catch (error) {
        console.error('Failed to load jobs:', error);
    }
}

// Create job card HTML
function createJobCard(job) {
    const statusClass = job.status === 'completed' ? 'success' : 
                       job.status === 'failed' ? 'error' : 
                       job.status === 'running' ? 'running' : 'pending';
    
    const statusIcon = job.status === 'completed' ? '✓' : 
                      job.status === 'failed' ? '✗' : 
                      job.status === 'running' ? '⟳' : '○';
    
    const duration = job.completedAt ? 
        Math.round((new Date(job.completedAt) - new Date(job.createdAt)) / 1000) : 
        Math.round((new Date() - new Date(job.createdAt)) / 1000);
    
    let resultHtml = '';
    if (job.status === 'completed' && job.result?.data) {
        resultHtml = `<div class="job-result">${formatResult(job.type, job.result.data)}</div>`;
    } else if (job.status === 'failed' && job.error) {
        resultHtml = `<div class="job-error">Error: ${job.error}</div>`;
    }
    
    return `
        <div class="job-card ${statusClass}">
            <div class="job-header">
                <div class="job-type">${getJobIcon(job.type)} ${formatJobType(job.type)}</div>
                <div class="job-status">${statusIcon} ${job.status}</div>
            </div>
            <div class="job-meta">
                <span class="job-id">ID: ${job.id.substring(0, 8)}...</span>
                <span class="job-time">${duration}s</span>
            </div>
            ${resultHtml}
        </div>
    `;
}

// Format job result
function formatResult(type, data) {
    switch (type) {
        case 'image-processing':
            return `
                <strong>Processed:</strong> ${data.operations.join(', ')}<br>
                <strong>Size:</strong> ${(data.fileSize / 1024).toFixed(0)}KB<br>
                <strong>Dimensions:</strong> ${data.dimensions.width}x${data.dimensions.height}
            `;
        case 'data-analysis':
            return `
                <strong>Records:</strong> ${data.recordsProcessed.toLocaleString()}<br>
                <strong>Average:</strong> ${data.results.summary.average.toFixed(2)}<br>
                ${data.results.trends ? `<strong>Trend:</strong> ${data.results.trends.direction} ${data.results.trends.percentage}%` : ''}
            `;
        case 'report-generation':
            return `
                <strong>Format:</strong> ${data.format.toUpperCase()}<br>
                <strong>Pages:</strong> ${data.pageCount}<br>
                <strong>Size:</strong> ${(data.fileSize / 1024).toFixed(0)}KB
            `;
        default:
            return JSON.stringify(data).substring(0, 100);
    }
}

// Get job icon
function getJobIcon(type) {
    const icons = {
        'image-processing': '📸',
        'data-analysis': '📊',
        'report-generation': '📄'
    };
    return icons[type] || '📋';
}

// Format job type
function formatJobType(type) {
    return type.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

// Submit image processing job
async function submitImageJob() {
    const imageUrl = document.getElementById('image-url').value;
    const operations = Array.from(document.querySelectorAll('#image-processing-form input[type="checkbox"]:checked'))
        .map(cb => cb.value);
    
    if (!imageUrl) {
        alert('Please enter an image URL');
        return;
    }
    
    await submitJob('image-processing', {
        imageUrl,
        operations,
        width: 1920,
        height: 1080,
        quality: 80
    });
}

// Submit data analysis job
async function submitDataJob() {
    const dataset = document.getElementById('dataset').value;
    const operations = Array.from(document.querySelectorAll('#data-analysis-form input[type="checkbox"]:checked'))
        .map(cb => cb.value);
    
    await submitJob('data-analysis', {
        dataset,
        operations
    });
}

// Submit report generation job
async function submitReportJob() {
    const reportType = document.getElementById('report-type').value;
    const format = document.getElementById('report-format').value;
    const includeCharts = document.getElementById('include-charts').checked;
    const includeSummary = document.getElementById('include-summary').checked;
    
    await submitJob('report-generation', {
        reportType,
        format,
        includeCharts,
        includeSummary
    });
}

// Submit job to API
async function submitJob(type, payload) {
    try {
        const response = await fetch(`${API_BASE}/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ type, payload })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            console.log('Job submitted:', data);
            loadJobs();
            loadStats();
        } else {
            alert(`Failed to submit job: ${data.error}`);
        }
    } catch (error) {
        console.error('Failed to submit job:', error);
        alert('Failed to submit job. Please try again.');
    }
}

// Clear all jobs
async function clearJobs() {
    if (!confirm('Are you sure you want to clear all jobs?')) {
        return;
    }
    
    try {
        await fetch(`${API_BASE}/jobs`, { method: 'DELETE' });
        loadJobs();
        loadStats();
    } catch (error) {
        console.error('Failed to clear jobs:', error);
    }
}

