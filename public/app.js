document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('config-form');
  const startBtn = document.getElementById('start-btn');
  const btnText = startBtn.querySelector('.btn-text');
  const consoleOutput = document.getElementById('console-output');
  const runStatusBadge = document.getElementById('run-status-badge');
  const resultsBody = document.getElementById('results-body');

  let eventSource = null;

  // Helper to add lines to the terminal console
  const appendConsoleLine = (text, type = 'info') => {
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    consoleOutput.appendChild(line);
    
    // Auto-scroll to bottom of console container
    const consoleBody = consoleOutput.parentElement;
    consoleBody.scrollTop = consoleBody.scrollHeight;
  };

  // Helper to copy text to clipboard with tooltip animation
  window.copyToClipboard = (text, btnElement) => {
    navigator.clipboard.writeText(text).then(() => {
      btnElement.classList.add('copied');
      setTimeout(() => {
        btnElement.classList.remove('copied');
      }, 1500);
    }).catch(err => {
      console.error('Clipboard copy failed:', err);
    });
  };

  // Render/Update the coupons results table
  const updateResultsTable = (results) => {
    if (!results || results.length === 0) {
      resultsBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="4">No results yet. Run the validator to see verified codes here.</td>
        </tr>
      `;
      return;
    }

    resultsBody.innerHTML = results.map(res => {
      const statusClass = res.status.toLowerCase();
      const pillClass = res.status === 'SUCCESS' ? 'success' : 'failed';
      
      return `
        <tr>
          <td class="coupon-code-cell">${res.coupon}</td>
          <td><span class="status-pill ${pillClass}">${res.status}</span></td>
          <td class="details-cell">${res.details || 'N/A'}</td>
          <td>
            <button class="btn-copy" onclick="copyToClipboard('${res.coupon}', this)">Copy</button>
          </td>
        </tr>
      `;
    }).join('');
  };

  // Handle Form Submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // Close any previous event source
    if (eventSource) {
      eventSource.close();
    }

    // Get Form Data
    const formData = new FormData(form);
    const site = formData.get('site');
    const minCartValue = formData.get('minCartValue');
    const customCoupons = formData.get('customCoupons');
    const headed = form.querySelector('#headed-toggle').checked;
    const backendUrl = formData.get('backendUrl') || '';

    // Reset UI State
    consoleOutput.innerHTML = '';
    appendConsoleLine('⚡ Initiating backend automation runner...', 'system');
    
    runStatusBadge.textContent = 'Running';
    runStatusBadge.className = 'badge badge-running';
    
    startBtn.disabled = true;
    btnText.textContent = 'Running Validation...';
    
    updateResultsTable([]);

    // Construct SSE query URL
    const queryParams = new URLSearchParams({
      site,
      minCartValue,
      customCoupons,
      headed
    });

    // Start Server-Sent Events stream connection (relative or absolute)
    const baseApiUrl = backendUrl ? `${backendUrl.replace(/\/$/, '')}/api/scrape` : '/api/scrape';
    eventSource = new EventSource(`${baseApiUrl}?${queryParams.toString()}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle logs (info, warning, success, error)
        if (data.type === 'results') {
          updateResultsTable(data.data);
        } else {
          appendConsoleLine(data.message, data.type);
        }
      } catch (err) {
        console.error('Error parsing event data:', err);
      }
    };

    eventSource.onerror = (error) => {
      // EventSource returns error when connection closes successfully or fails
      appendConsoleLine('🔌 Execution flow finished or connection closed.', 'system');
      
      runStatusBadge.textContent = 'Finished';
      runStatusBadge.className = 'badge badge-done';
      
      startBtn.disabled = false;
      btnText.textContent = 'Start Validation Run';
      
      eventSource.close();
      eventSource = null;
    };
  });
});
