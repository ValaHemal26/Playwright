import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

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
  const [customBackendUrl, setCustomBackendUrl] = useState<string>('');
  const [oracleHost, setOracleHost] = useState<string>('YOUR_ORACLE_IP');

  // Execution State
  const [status, setStatus] = useState<'idle' | 'queued' | 'running' | 'done'>('idle');
  const [executionTime, setExecutionTime] = useState<number>(0);
  const [logs, setLogs] = useState<LogLine[]>([
    {
      text: 'Ready to launch. Click \'Start Validation Run\' above.',
      type: 'system',
      timestamp: new Date().toLocaleTimeString()
    }
  ]);
  const [results, setResults] = useState<CouponResult[]>([]);
  const [copiedCoupon, setCopiedCoupon] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const consoleBodyRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll console to bottom when new logs arrive
  useEffect(() => {
    if (consoleBodyRef.current) {
      consoleBodyRef.current.scrollTop = consoleBodyRef.current.scrollHeight;
    }
  }, [logs]);

  // Handle execution timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === 'running') {
      interval = setInterval(() => {
        setExecutionTime(prev => prev + 1);
      }, 1000);
    } else if (status === 'idle' || status === 'queued') {
      setExecutionTime(0);
    }
    return () => clearInterval(interval);
  }, [status]);

  // Establish connection to Render Backend Socket.IO on mount
  useEffect(() => {
    connectSocket();
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [customBackendUrl]);

  const connectSocket = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    let backendUrl = '';
    if (customBackendUrl.trim()) {
      backendUrl = customBackendUrl.trim();
    } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      backendUrl = 'http://localhost:5000';
    } else {
      backendUrl = 'https://playwright-w337.onrender.com';
    }

    setLogs(prev => [
      ...prev,
      {
        text: `🔌 Connecting to automation gateway at ${backendUrl}...`,
        type: 'system',
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    const socket = io(backendUrl, {
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setLogs(prev => [
        ...prev,
        {
          text: '✅ Connected to Render backend signaling gateway.',
          type: 'system',
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    });

    socket.on('log', (logData: LogLine) => {
      setLogs(prev => [...prev, logData]);
    });

    socket.on('results', (resultsData: CouponResult[]) => {
      setResults(resultsData);
    });

    socket.on('status', (statusData: { type: 'queued' | 'running' | 'done' | 'error' | 'busy' | 'idle'; message: string }) => {
      if (statusData.type === 'running') {
        setStatus('running');
      } else if (statusData.type === 'queued') {
        setStatus('queued');
      } else if (statusData.type === 'done' || statusData.type === 'error' || statusData.type === 'busy') {
        setStatus('done');
      } else if (statusData.type === 'idle') {
        setStatus('idle');
      }

      setLogs(prev => [
        ...prev,
        {
          text: statusData.message,
          type: 'system',
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    });

    socket.on('disconnect', () => {
      setLogs(prev => [
        ...prev,
        {
          text: '❌ Disconnected from signaling gateway.',
          type: 'system',
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
      setStatus('idle');
    });
  };

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

  const handleStartTest = (e: React.FormEvent) => {
    e.preventDefault();

    if (!socketRef.current || !socketRef.current.connected) {
      setLogs(prev => [
        ...prev,
        {
          text: '⚠️ Cannot start validation. Reconnecting to gateway first...',
          type: 'warning',
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
      connectSocket();
      return;
    }

    // Reset results & state
    setResults([]);
    setExecutionTime(0);

    // Emit parameters over socket
    socketRef.current.emit('run-test', {
      site,
      minCartValue,
      customCoupons,
      headed
    });
  };

  const handleStopTest = () => {
    if (socketRef.current) {
      socketRef.current.emit('stop-test');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
          <p className="tagline">Playwright Live Headed Scraper & Checkout verification platform</p>
        </header>

        <main className="dashboard-grid">
          {/* Input Panel */}
          <section className="panel-card config-panel">
            <div className="panel-header">
              <h2>Automation Parameters</h2>
              <p>Configure and watch tests execute in real time on the Oracle VM</p>
            </div>

            <form onSubmit={handleStartTest} className="config-form">
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
                  placeholder="Enter coupon codes separated by commas or new lines."
                />
              </div>

              <div className="input-group">
                <label htmlFor="oracle-host-input">Oracle VM IP / Hostname</label>
                <input
                  type="text"
                  id="oracle-host-input"
                  value={oracleHost}
                  onChange={(e) => setOracleHost(e.target.value)}
                  placeholder="e.g., 129.146.xx.xx"
                />
                <span className="input-hint">Points the live remote view frame to your websockify stream.</span>
              </div>

              <div className="input-group">
                <label htmlFor="backend-url-input">
                  Render Backend Gateway <span className="optional-tag">(Optional)</span>
                </label>
                <input
                  type="text"
                  id="backend-url-input"
                  placeholder="https://playwright-w337.onrender.com"
                  value={customBackendUrl}
                  onChange={(e) => setCustomBackendUrl(e.target.value)}
                />
                <span className="input-hint">Specify custom Socket.IO signalling gateway address.</span>
              </div>

              <div className="input-group inline-toggle" style={{ display: 'none' }}>
                {/* Kept headed config hidden or default true since VM requires headed mode to capture stream */}
                <input type="checkbox" id="headed-toggle" checked={headed} onChange={() => setHeaded(true)} />
              </div>

              <div className="action-buttons-group" style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <button
                  type="submit"
                  id="start-btn"
                  className="btn btn-primary"
                  style={{ flex: 2 }}
                  disabled={status === 'running' || status === 'queued'}
                >
                  <span className="btn-text">
                    {status === 'running' ? 'Running...' : status === 'queued' ? 'In Queue...' : 'Start Validation Run'}
                  </span>
                  <span className="glow-pulse"></span>
                </button>

                <button
                  type="button"
                  id="stop-btn"
                  className="btn btn-secondary"
                  style={{ flex: 1, backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#ef4444' }}
                  onClick={handleStopTest}
                  disabled={status === 'idle'}
                >
                  Stop Run
                </button>
              </div>

              <button
                type="button"
                className="btn-reconnect"
                style={{ marginTop: '1rem', width: '100%', background: 'transparent', border: '1px dashed var(--border-light)', color: 'var(--text-muted)', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer' }}
                onClick={connectSocket}
              >
                🔄 Reconnect Signal Gateway
              </button>
            </form>
          </section>

          {/* Live Terminal Console */}
          <section className="panel-card console-panel">
            <div className="panel-header">
              <h2>Live Process Monitor</h2>
              <p>Real-time execution logs from Playwright context</p>
              <div className="console-actions" style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  ⏱️ {formatTime(executionTime)}
                </span>
                <span
                  id="run-status-badge"
                  className={`badge ${
                    status === 'running'
                      ? 'badge-running'
                      : status === 'queued'
                      ? 'badge-queued'
                      : status === 'done'
                      ? 'badge-done'
                      : 'badge-idle'
                  }`}
                >
                  {status === 'running' ? 'Running' : status === 'queued' ? 'Queued' : status === 'done' ? 'Finished' : 'Idle'}
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

          {/* Remote Live VNC Stream Viewport */}
          {status === 'running' && (
            <section className="panel-card video-panel full-width">
              <div className="panel-header">
                <h2>🖥️ Live Browser View (noVNC Stream)</h2>
                <p>Interactive mirror of the remote headed Playwright execution inside Oracle VM</p>
              </div>
              <div className="video-body" style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem', width: '100%' }}>
                <div style={{ position: 'relative', width: '100%', maxWidth: '960px', paddingBottom: '56.25%', background: '#000', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-light)', boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)' }}>
                  <iframe
                    src={`https://${oracleHost}/live?autoconnect=true&resize=scale`}
                    title="noVNC Browser Stream"
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                    allowFullScreen
                  />
                </div>
              </div>
            </section>
          )}

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
