import React, { useState, useEffect, useRef } from 'react';

interface LogLine {
  text: string;
  type: string;
  timestamp: string;
}

interface CouponResult {
  coupon: string;
  status: string;
  details?: string;
}

function App() {
  // Form State
  const [site, setSite] = useState<string>('wethrift');
  const [minCartValue, setMinCartValue] = useState<number>(300);
  const [customCoupons, setCustomCoupons] = useState<string>('');
  const [headed, setHeaded] = useState<boolean>(true);

  // Execution State
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [logs, setLogs] = useState<LogLine[]>([
    {
      text: 'Ready to launch. Click \'Start Validation Run\' above.',
      type: 'system',
      timestamp: new Date().toLocaleTimeString()
    }
  ]);
  const [results, setResults] = useState<CouponResult[]>([]);
  const [copiedCoupon, setCopiedCoupon] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const consoleBodyRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll console to bottom when new logs arrive
  useEffect(() => {
    if (consoleBodyRef.current) {
      consoleBodyRef.current.scrollTop = consoleBodyRef.current.scrollHeight;
    }
  }, [logs]);

  // Clean up EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleCopy = (coupon: string) => {
    navigator.clipboard.writeText(coupon).then(() => {
      setCopiedCoupon(coupon);
      setTimeout(() => {
        setCopiedCoupon(null);
      }, 1500);
    }).catch(err => {
      console.error('Clipboard copy failed:', err);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Close any previous stream
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Determine Backend URL (changed default local port to 5000)
    let backendUrl = '';
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      backendUrl = 'http://localhost:5000';
    } else {
      backendUrl = 'https://playwright-w337.onrender.com';
    }

    // Reset State
    setLogs([
      {
        text: '⚡ Initiating backend automation runner...',
        type: 'system',
        timestamp: new Date().toLocaleTimeString()
      }
    ]);
    setResults([]);
    setStatus('running');

    // Build query params
    const queryParams = new URLSearchParams({
      site,
      minCartValue: minCartValue.toString(),
      customCoupons,
      headed: headed.toString()
    });

    const baseApiUrl = `${backendUrl}/api/scrape`;
    const sseUrl = `${baseApiUrl}?${queryParams.toString()}`;

    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'results') {
          setResults(data.data || []);
        } else {
          setLogs(prev => [
            ...prev,
            {
              text: data.message,
              type: data.type || 'info',
              timestamp: new Date().toLocaleTimeString()
            }
          ]);
        }
      } catch (err) {
        console.error('Error parsing event data:', err);
      }
    };

    es.onerror = (error) => {
      setLogs(prev => [
        ...prev,
        {
          text: '🔌 Execution flow finished or connection closed.',
          type: 'system',
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
      setStatus('done');
      es.close();
      eventSourceRef.current = null;
    };
  };

  return (
    <>
      <div className="glow-container">
        <div className="glow-orb glow-orb-1"></div>
        <div className="glow-orb glow-orb-2"></div>
      </div>

      <div className="app-container">
        <header className="app-header">
          <div className="logo-area">
            <span className="logo-icon">%</span>
            <h1>AutoSave</h1>
          </div>
          <p className="tagline">Automated Coupon Scraper & checkout verification platform</p>
        </header>

        <main className="dashboard-grid">
          {/* Input Panel */}
          <section className="panel-card config-panel">
            <div className="panel-header">
              <h2>Automation Parameters</h2>
              <p>Configure how coupons are scraped and tested</p>
            </div>

            <form onSubmit={handleSubmit} className="config-form">
              <div className="input-group">
                <label htmlFor="site-select">Coupon Source Site</label>
                <div className="select-wrapper">
                  <select
                    id="site-select"
                    name="site"
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                  >
                    <option value="wethrift">wethrift.com (Tab-Switch Method)</option>
                    <option value="grabon">grabon.in (Fast Attribute Extraction)</option>
                  </select>
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="cart-value-input">Minimum Cart Value (₹)</label>
                <input
                  type="number"
                  id="cart-value-input"
                  name="minCartValue"
                  value={minCartValue}
                  onChange={(e) => setMinCartValue(Number(e.target.value))}
                  min="50"
                  max="1000"
                />
                <span className="input-hint">Pizzas will be added until subtotal reaches this amount.</span>
              </div>

              <div className="input-group">
                <label htmlFor="custom-coupons">
                  Custom Coupons List <span className="optional-tag">(Optional)</span>
                </label>
                <textarea
                  id="custom-coupons"
                  name="customCoupons"
                  value={customCoupons}
                  onChange={(e) => setCustomCoupons(e.target.value)}
                  placeholder="Enter coupon codes separated by commas or new lines. E.g. YUM4271, FREE2504. Leaving this blank will auto-scrape codes."
                />
              </div>

              <div className="input-group inline-toggle">
                <label htmlFor="headed-toggle">Run in Headed Browser</label>
                <label className="switch">
                  <input
                    type="checkbox"
                    id="headed-toggle"
                    name="headed"
                    checked={headed}
                    onChange={(e) => setHeaded(e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <button
                type="submit"
                id="start-btn"
                className="btn btn-primary"
                disabled={status === 'running'}
              >
                <span className="btn-text">
                  {status === 'running' ? 'Running Validation...' : 'Start Validation Run'}
                </span>
                <span className="glow-pulse"></span>
              </button>
            </form>
          </section>

          {/* Live Terminal Console */}
          <section className="panel-card console-panel">
            <div className="panel-header">
              <h2>Live Process Monitor</h2>
              <p>Real-time execution logs from Playwright context</p>
              <div className="console-actions">
                <span
                  id="run-status-badge"
                  className={`badge ${
                    status === 'running'
                      ? 'badge-running'
                      : status === 'done'
                      ? 'badge-done'
                      : 'badge-idle'
                  }`}
                >
                  {status === 'running' ? 'Running' : status === 'done' ? 'Finished' : 'Idle'}
                </span>
              </div>
            </div>

            <div ref={consoleBodyRef} className="console-body">
              <div id="console-output" className="console-output">
                {logs.map((log, index) => (
                  <div key={index} className={`console-line ${log.type}`}>
                    [{log.timestamp}] {log.text}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Verified Coupons Grid */}
          <section className="panel-card results-panel full-width">
            <div className="panel-header">
              <h2>Verification Results</h2>
              <p>Verified active coupon codes from the checkout run</p>
            </div>

            <div className="results-table-container">
              <table className="results-table" id="results-table">
                <thead>
                  <tr>
                    <th>Coupon Code</th>
                    <th>Status</th>
                    <th>Discount Details</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="results-body">
                  {results.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={4}>No results yet. Run the validator to see verified codes here.</td>
                    </tr>
                  ) : (
                    results.map((res, index) => {
                      const pillClass = res.status === 'SUCCESS' ? 'success' : 'failed';
                      return (
                        <tr key={index}>
                          <td className="coupon-code-cell">{res.coupon}</td>
                          <td>
                            <span className={`status-pill ${pillClass}`}>{res.status}</span>
                          </td>
                          <td className="details-cell">{res.details || 'N/A'}</td>
                          <td>
                            <button
                              className={`btn-copy ${copiedCoupon === res.coupon ? 'copied' : ''}`}
                              onClick={() => handleCopy(res.coupon)}
                            >
                              Copy
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

export default App;
